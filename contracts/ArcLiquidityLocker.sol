// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArcLockerToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ArcLiquidityLocker {
    struct Lock {
        address token;
        address owner;
        address beneficiary;
        uint256 amount;
        uint256 unlocksAt;
        bool withdrawn;
    }

    uint256 public nextLockId = 1;
    mapping(uint256 => Lock) public locks;

    event LiquidityLocked(
        uint256 indexed lockId,
        address indexed owner,
        address indexed token,
        address beneficiary,
        uint256 amount,
        uint256 unlocksAt
    );
    event LockExtended(uint256 indexed lockId, uint256 unlocksAt);
    event LiquidityWithdrawn(uint256 indexed lockId, address indexed beneficiary, uint256 amount);

    function lock(
        address token,
        uint256 amount,
        address beneficiary,
        uint256 durationSeconds
    ) external returns (uint256 lockId) {
        require(token != address(0), "BAD_TOKEN");
        require(amount > 0, "BAD_AMOUNT");
        require(beneficiary != address(0), "BAD_BENEFICIARY");
        require(durationSeconds > 0, "BAD_DURATION");

        require(IArcLockerToken(token).transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM_FAILED");
        lockId = nextLockId++;
        locks[lockId] = Lock({
            token: token,
            owner: msg.sender,
            beneficiary: beneficiary,
            amount: amount,
            unlocksAt: block.timestamp + durationSeconds,
            withdrawn: false
        });

        emit LiquidityLocked(lockId, msg.sender, token, beneficiary, amount, locks[lockId].unlocksAt);
    }

    function extendLock(uint256 lockId, uint256 newUnlocksAt) external {
        Lock storage item = locks[lockId];
        require(item.owner == msg.sender, "NOT_LOCK_OWNER");
        require(!item.withdrawn, "WITHDRAWN");
        require(newUnlocksAt > item.unlocksAt, "BAD_UNLOCK");
        item.unlocksAt = newUnlocksAt;
        emit LockExtended(lockId, newUnlocksAt);
    }

    function withdraw(uint256 lockId) external {
        Lock storage item = locks[lockId];
        require(!item.withdrawn, "WITHDRAWN");
        require(block.timestamp >= item.unlocksAt, "LOCKED");
        require(msg.sender == item.owner || msg.sender == item.beneficiary, "NOT_AUTHORIZED");

        item.withdrawn = true;
        require(IArcLockerToken(item.token).transfer(item.beneficiary, item.amount), "TRANSFER_FAILED");
        emit LiquidityWithdrawn(lockId, item.beneficiary, item.amount);
    }
}
