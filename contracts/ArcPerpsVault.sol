// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IArcPerpsOracle {
    function getPrice(bytes32 symbol) external view returns (uint256 price, uint256 timestamp);
}

contract ArcPerpsVault {
    struct Position {
        address owner;
        bytes32 symbol;
        bool isLong;
        uint256 margin;
        uint256 notional;
        uint256 entryPrice;
        uint256 leverageBps;
        uint256 openedAt;
        bool open;
    }

    IERC20 public immutable usdc;
    IArcPerpsOracle public oracle;
    address public owner;
    uint256 public nextPositionId = 1;
    uint256 public poolBalance;
    uint256 public maxLeverageBps = 30_000;
    uint256 public maintenanceMarginBps = 500;

    mapping(address => uint256) public marginBalances;
    mapping(uint256 => Position) public positions;
    mapping(bytes32 => bool) public markets;

    event MarginDeposited(address indexed account, uint256 amount);
    event MarginWithdrawn(address indexed account, uint256 amount);
    event LiquidityProvided(address indexed provider, uint256 amount);
    event LiquidityWithdrawn(address indexed receiver, uint256 amount);
    event MarketSet(bytes32 indexed symbol, bool enabled);
    event PositionOpened(
        uint256 indexed positionId,
        address indexed account,
        bytes32 indexed symbol,
        bool isLong,
        uint256 margin,
        uint256 notional,
        uint256 entryPrice,
        uint256 leverageBps
    );
    event PositionClosed(uint256 indexed positionId, address indexed account, uint256 exitPrice, int256 pnl, uint256 payout);
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 markPrice, int256 pnl);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(address usdc_, address oracle_) {
        require(usdc_ != address(0), "BAD_USDC");
        require(oracle_ != address(0), "BAD_ORACLE");
        owner = msg.sender;
        usdc = IERC20(usdc_);
        oracle = IArcPerpsOracle(oracle_);
    }

    function setMarket(bytes32 symbol, bool enabled) external onlyOwner {
        markets[symbol] = enabled;
        emit MarketSet(symbol, enabled);
    }

    function setRisk(uint256 maxLeverageBps_, uint256 maintenanceMarginBps_) external onlyOwner {
        require(maxLeverageBps_ >= 10_000 && maxLeverageBps_ <= 100_000, "BAD_MAX_LEVERAGE");
        require(maintenanceMarginBps_ > 0 && maintenanceMarginBps_ <= 2_000, "BAD_MAINTENANCE");
        maxLeverageBps = maxLeverageBps_;
        maintenanceMarginBps = maintenanceMarginBps_;
    }

    function depositMargin(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM_FAILED");
        marginBalances[msg.sender] += amount;
        emit MarginDeposited(msg.sender, amount);
    }

    function withdrawMargin(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(marginBalances[msg.sender] >= amount, "INSUFFICIENT_MARGIN");
        marginBalances[msg.sender] -= amount;
        require(usdc.transfer(msg.sender, amount), "TRANSFER_FAILED");
        emit MarginWithdrawn(msg.sender, amount);
    }

    function provideLiquidity(uint256 amount) external {
        require(amount > 0, "BAD_AMOUNT");
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM_FAILED");
        poolBalance += amount;
        emit LiquidityProvided(msg.sender, amount);
    }

    function withdrawLiquidity(uint256 amount, address receiver) external onlyOwner {
        require(amount > 0, "BAD_AMOUNT");
        require(poolBalance >= amount, "INSUFFICIENT_POOL");
        poolBalance -= amount;
        require(usdc.transfer(receiver, amount), "TRANSFER_FAILED");
        emit LiquidityWithdrawn(receiver, amount);
    }

    function openPosition(bytes32 symbol, bool isLong, uint256 margin, uint256 leverageBps) external returns (uint256 positionId) {
        require(markets[symbol], "MARKET_DISABLED");
        require(margin > 0, "BAD_MARGIN");
        require(leverageBps >= 10_000 && leverageBps <= maxLeverageBps, "BAD_LEVERAGE");
        require(marginBalances[msg.sender] >= margin, "INSUFFICIENT_MARGIN");

        (uint256 entryPrice,) = oracle.getPrice(symbol);
        uint256 notional = margin * leverageBps / 10_000;

        marginBalances[msg.sender] -= margin;
        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            symbol: symbol,
            isLong: isLong,
            margin: margin,
            notional: notional,
            entryPrice: entryPrice,
            leverageBps: leverageBps,
            openedAt: block.timestamp,
            open: true
        });

        emit PositionOpened(positionId, msg.sender, symbol, isLong, margin, notional, entryPrice, leverageBps);
    }

    function closePosition(uint256 positionId) external {
        Position storage position = positions[positionId];
        require(position.open, "POSITION_CLOSED");
        require(position.owner == msg.sender, "NOT_POSITION_OWNER");

        (uint256 markPrice,) = oracle.getPrice(position.symbol);
        int256 pnl = getPnl(positionId, markPrice);
        uint256 payout = _settle(position, pnl);
        emit PositionClosed(positionId, msg.sender, markPrice, pnl, payout);
    }

    function liquidate(uint256 positionId) external {
        Position storage position = positions[positionId];
        require(position.open, "POSITION_CLOSED");

        (uint256 markPrice,) = oracle.getPrice(position.symbol);
        int256 pnl = getPnl(positionId, markPrice);
        int256 equity = int256(position.margin) + pnl;
        uint256 maintenance = position.notional * maintenanceMarginBps / 10_000;
        require(equity <= int256(maintenance), "NOT_LIQUIDATABLE");

        _settle(position, pnl);
        emit PositionLiquidated(positionId, msg.sender, markPrice, pnl);
    }

    function getPnl(uint256 positionId, uint256 markPrice) public view returns (int256) {
        Position memory position = positions[positionId];
        require(position.open, "POSITION_CLOSED");
        require(markPrice > 0, "BAD_MARK_PRICE");

        if (position.isLong) {
            return int256(position.notional * markPrice / position.entryPrice) - int256(position.notional);
        }

        return int256(position.notional) - int256(position.notional * markPrice / position.entryPrice);
    }

    function getLiquidationPrice(uint256 positionId) external view returns (uint256) {
        Position memory position = positions[positionId];
        require(position.open, "POSITION_CLOSED");
        uint256 maxLoss = position.margin - (position.notional * maintenanceMarginBps / 10_000);
        uint256 priceMove = position.entryPrice * maxLoss / position.notional;

        if (position.isLong) {
            return position.entryPrice > priceMove ? position.entryPrice - priceMove : 0;
        }

        return position.entryPrice + priceMove;
    }

    function _settle(Position storage position, int256 pnl) internal returns (uint256 payout) {
        position.open = false;

        if (pnl >= 0) {
            uint256 profit = uint256(pnl);
            require(poolBalance >= profit, "INSUFFICIENT_POOL");
            poolBalance -= profit;
            payout = position.margin + profit;
            marginBalances[position.owner] += payout;
            return payout;
        }

        uint256 loss = uint256(-pnl);
        if (loss >= position.margin) {
            poolBalance += position.margin;
            return 0;
        }

        payout = position.margin - loss;
        poolBalance += loss;
        marginBalances[position.owner] += payout;
    }
}
