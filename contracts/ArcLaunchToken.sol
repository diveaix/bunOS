// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArcLaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable cap;
    bytes32 public immutable metadataHash;
    address public immutable factory;
    address public owner;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed holder, address indexed spender, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 cap_,
        address owner_,
        bytes32 metadataHash_
    ) {
        require(bytes(name_).length > 0, "BAD_NAME");
        require(bytes(symbol_).length > 0, "BAD_SYMBOL");
        require(cap_ > 0, "BAD_CAP");
        require(owner_ != address(0), "BAD_OWNER");

        name = name_;
        symbol = symbol_;
        cap = cap_;
        owner = owner_;
        factory = msg.sender;
        metadataHash = metadataHash_;
        _mint(owner_, cap_);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        require(approved >= amount, "ALLOWANCE");
        if (approved != type(uint256).max) {
            allowance[from][msg.sender] = approved - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "BAD_OWNER");
        address previousOwner = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previousOwner, nextOwner);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "BAD_TO");
        require(balanceOf[from] >= amount, "BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(totalSupply + amount <= cap, "CAP");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
