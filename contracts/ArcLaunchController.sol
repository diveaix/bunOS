// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArcLaunchFactory {
    function deployToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        bytes32 metadataHash,
        bytes32 salt,
        address creator
    ) external returns (uint256 launchId, address token);

    function setLaunchStatus(uint256 launchId, uint8 status) external;
}

interface IArcLaunchLocker {
    function lock(
        address token,
        uint256 amount,
        address beneficiary,
        uint256 durationSeconds
    ) external returns (uint256 lockId);
}

interface IArcLaunchAsset {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ArcLaunchController {
    enum Stage {
        Draft,
        TokenDeployed,
        LiquiditySeeded,
        Live,
        Paused
    }

    struct Launch {
        uint256 factoryLaunchId;
        address creator;
        address token;
        address baseAsset;
        bytes32 metadataHash;
        uint256 tokenLiquidityAmount;
        uint256 baseLiquidityAmount;
        uint256 liquidityLockId;
        Stage stage;
        uint256 createdAt;
        uint256 liveAt;
    }

    IArcLaunchFactory public immutable factory;
    IArcLaunchLocker public immutable locker;
    uint256 public nextControllerLaunchId = 1;
    mapping(uint256 => Launch) public launches;

    event ControllerLaunchCreated(
        uint256 indexed controllerLaunchId,
        uint256 indexed factoryLaunchId,
        address indexed creator,
        address token,
        address baseAsset
    );
    event LaunchLiquiditySeeded(
        uint256 indexed controllerLaunchId,
        address indexed token,
        address indexed baseAsset,
        uint256 tokenAmount,
        uint256 baseAmount,
        uint256 lockId
    );
    event LaunchTradingOpened(uint256 indexed controllerLaunchId, address indexed token, address indexed baseAsset);
    event LaunchPaused(uint256 indexed controllerLaunchId);

    modifier onlyCreator(uint256 controllerLaunchId) {
        require(launches[controllerLaunchId].creator == msg.sender, "NOT_CREATOR");
        _;
    }

    constructor(address factory_, address locker_) {
        require(factory_ != address(0), "BAD_FACTORY");
        require(locker_ != address(0), "BAD_LOCKER");
        factory = IArcLaunchFactory(factory_);
        locker = IArcLaunchLocker(locker_);
    }

    function createAndDeployToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        bytes32 metadataHash,
        bytes32 salt,
        address baseAsset
    ) external returns (uint256 controllerLaunchId, uint256 factoryLaunchId, address token) {
        require(baseAsset != address(0), "BAD_BASE_ASSET");

        (factoryLaunchId, token) = factory.deployToken(name, symbol, totalSupply, metadataHash, salt, msg.sender);
        controllerLaunchId = nextControllerLaunchId++;
        launches[controllerLaunchId] = Launch({
            factoryLaunchId: factoryLaunchId,
            creator: msg.sender,
            token: token,
            baseAsset: baseAsset,
            metadataHash: metadataHash,
            tokenLiquidityAmount: 0,
            baseLiquidityAmount: 0,
            liquidityLockId: 0,
            stage: Stage.TokenDeployed,
            createdAt: block.timestamp,
            liveAt: 0
        });

        emit ControllerLaunchCreated(controllerLaunchId, factoryLaunchId, msg.sender, token, baseAsset);
    }

    function seedLiquidity(
        uint256 controllerLaunchId,
        uint256 tokenAmount,
        uint256 baseAmount,
        uint256 lockDurationSeconds
    ) external onlyCreator(controllerLaunchId) returns (uint256 lockId) {
        Launch storage launch = launches[controllerLaunchId];
        require(launch.stage == Stage.TokenDeployed, "BAD_STAGE");
        require(tokenAmount > 0 && baseAmount > 0, "BAD_AMOUNTS");

        require(IArcLaunchAsset(launch.token).transferFrom(msg.sender, address(this), tokenAmount), "TOKEN_TRANSFER_FAILED");
        require(IArcLaunchAsset(launch.baseAsset).transferFrom(msg.sender, address(this), baseAmount), "BASE_TRANSFER_FAILED");

        require(IArcLaunchAsset(launch.token).approve(address(locker), tokenAmount), "TOKEN_APPROVE_FAILED");
        lockId = locker.lock(launch.token, tokenAmount, msg.sender, lockDurationSeconds);

        launch.tokenLiquidityAmount = tokenAmount;
        launch.baseLiquidityAmount = baseAmount;
        launch.liquidityLockId = lockId;
        launch.stage = Stage.LiquiditySeeded;
        factory.setLaunchStatus(launch.factoryLaunchId, 2);

        emit LaunchLiquiditySeeded(controllerLaunchId, launch.token, launch.baseAsset, tokenAmount, baseAmount, lockId);
    }

    function openTrading(uint256 controllerLaunchId) external onlyCreator(controllerLaunchId) {
        Launch storage launch = launches[controllerLaunchId];
        require(launch.stage == Stage.LiquiditySeeded, "BAD_STAGE");
        launch.stage = Stage.Live;
        launch.liveAt = block.timestamp;
        factory.setLaunchStatus(launch.factoryLaunchId, 3);
        emit LaunchTradingOpened(controllerLaunchId, launch.token, launch.baseAsset);
    }

    function pause(uint256 controllerLaunchId) external onlyCreator(controllerLaunchId) {
        Launch storage launch = launches[controllerLaunchId];
        require(launch.stage != Stage.Paused, "ALREADY_PAUSED");
        launch.stage = Stage.Paused;
        factory.setLaunchStatus(launch.factoryLaunchId, 4);
        emit LaunchPaused(controllerLaunchId);
    }
}
