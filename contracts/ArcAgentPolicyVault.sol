// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArcAgentPolicyVault {
    struct Policy {
        address creator;
        uint256 maxBudgetUsd;
        uint256 maxSlippageBps;
        uint256 liquidityLockDays;
        bool paused;
        uint256 updatedAt;
    }

    mapping(bytes32 => Policy) public policies;
    mapping(bytes32 => mapping(bytes32 => bool)) public grants;

    event PolicyUpdated(
        bytes32 indexed launchKey,
        address indexed creator,
        uint256 maxBudgetUsd,
        uint256 maxSlippageBps,
        uint256 liquidityLockDays,
        bool paused
    );
    event GrantSet(bytes32 indexed launchKey, bytes32 indexed action, bool allowed);
    event PolicyPaused(bytes32 indexed launchKey, bool paused);

    modifier onlyCreator(bytes32 launchKey) {
        require(policies[launchKey].creator == msg.sender, "NOT_CREATOR");
        _;
    }

    function setPolicy(
        bytes32 launchKey,
        uint256 maxBudgetUsd,
        uint256 maxSlippageBps,
        uint256 liquidityLockDays,
        bytes32[] calldata allowedActions
    ) external {
        require(launchKey != bytes32(0), "BAD_LAUNCH");
        require(maxSlippageBps <= 5_000, "BAD_SLIPPAGE");

        Policy storage policy = policies[launchKey];
        if (policy.creator == address(0)) {
            policy.creator = msg.sender;
        } else {
            require(policy.creator == msg.sender, "NOT_CREATOR");
        }

        policy.maxBudgetUsd = maxBudgetUsd;
        policy.maxSlippageBps = maxSlippageBps;
        policy.liquidityLockDays = liquidityLockDays;
        policy.updatedAt = block.timestamp;

        for (uint256 i = 0; i < allowedActions.length; i++) {
            grants[launchKey][allowedActions[i]] = true;
            emit GrantSet(launchKey, allowedActions[i], true);
        }

        emit PolicyUpdated(
            launchKey,
            policy.creator,
            policy.maxBudgetUsd,
            policy.maxSlippageBps,
            policy.liquidityLockDays,
            policy.paused
        );
    }

    function revokeGrant(bytes32 launchKey, bytes32 action) external onlyCreator(launchKey) {
        grants[launchKey][action] = false;
        policies[launchKey].updatedAt = block.timestamp;
        emit GrantSet(launchKey, action, false);
    }

    function setPaused(bytes32 launchKey, bool paused) external onlyCreator(launchKey) {
        policies[launchKey].paused = paused;
        policies[launchKey].updatedAt = block.timestamp;
        emit PolicyPaused(launchKey, paused);
    }

    function canAgentExecute(bytes32 launchKey, bytes32 action) external view returns (bool) {
        Policy memory policy = policies[launchKey];
        return policy.creator != address(0) && !policy.paused && grants[launchKey][action];
    }
}
