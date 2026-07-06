// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArcPerpsOracle {
    address public owner;
    mapping(address => bool) public updaters;
    mapping(bytes32 => uint256) public prices;
    mapping(bytes32 => uint256) public updatedAt;

    event PriceUpdated(bytes32 indexed symbol, uint256 price, uint256 updatedAt);
    event UpdaterSet(address indexed updater, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyUpdater() {
        require(msg.sender == owner || updaters[msg.sender], "NOT_UPDATER");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setUpdater(address updater, bool allowed) external onlyOwner {
        updaters[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setPrice(bytes32 symbol, uint256 price) external onlyUpdater {
        require(price > 0, "BAD_PRICE");
        prices[symbol] = price;
        updatedAt[symbol] = block.timestamp;
        emit PriceUpdated(symbol, price, block.timestamp);
    }

    function getPrice(bytes32 symbol) external view returns (uint256 price, uint256 timestamp) {
        price = prices[symbol];
        timestamp = updatedAt[symbol];
        require(price > 0, "NO_PRICE");
    }
}
