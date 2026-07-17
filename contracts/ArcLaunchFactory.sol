// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ArcLaunchToken.sol";

contract ArcLaunchFactory {
    struct LaunchRecord {
        address creator;
        address token;
        string name;
        string symbol;
        uint256 totalSupply;
        bytes32 metadataHash;
        bytes32 salt;
        uint8 status;
        uint256 createdAt;
        uint256 updatedAt;
    }

    address public owner;
    uint256 public nextLaunchId = 1;
    mapping(uint256 => LaunchRecord) public launches;
    mapping(address => uint256) public launchByToken;
    mapping(address => bool) public controllers;

    event LaunchTokenDeployed(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        string symbol,
        uint256 totalSupply,
        bytes32 salt,
        bytes32 metadataHash
    );
    event LaunchStatusUpdated(uint256 indexed launchId, uint8 status);
    event ControllerSet(address indexed controller, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyLaunchOperator(uint256 launchId) {
        require(
            launches[launchId].creator == msg.sender || controllers[msg.sender] || owner == msg.sender,
            "NOT_LAUNCH_OPERATOR"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function deployToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        bytes32 metadataHash,
        bytes32 salt,
        address creator
    ) external returns (uint256 launchId, address token) {
        require(creator != address(0), "BAD_CREATOR");
        require(totalSupply > 0, "BAD_SUPPLY");

        token = address(new ArcLaunchToken{salt: salt}(name, symbol, totalSupply, creator, metadataHash));
        launchId = nextLaunchId++;
        launches[launchId] = LaunchRecord({
            creator: creator,
            token: token,
            name: name,
            symbol: symbol,
            totalSupply: totalSupply,
            metadataHash: metadataHash,
            salt: salt,
            status: 1,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });
        launchByToken[token] = launchId;

        emit LaunchTokenDeployed(launchId, creator, token, symbol, totalSupply, salt, metadataHash);
    }

    function setController(address controller, bool allowed) external onlyOwner {
        controllers[controller] = allowed;
        emit ControllerSet(controller, allowed);
    }

    function setLaunchStatus(uint256 launchId, uint8 status) external onlyLaunchOperator(launchId) {
        require(launches[launchId].creator != address(0), "UNKNOWN_LAUNCH");
        launches[launchId].status = status;
        launches[launchId].updatedAt = block.timestamp;
        emit LaunchStatusUpdated(launchId, status);
    }

    function predictTokenAddress(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        bytes32 metadataHash,
        bytes32 salt,
        address creator
    ) external view returns (address) {
        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(ArcLaunchToken).creationCode,
                abi.encode(name, symbol, totalSupply, creator, metadataHash)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)))));
    }
}
