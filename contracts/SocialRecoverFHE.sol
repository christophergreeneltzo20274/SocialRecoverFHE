// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SocialRecoverFHE is SepoliaConfig {
    struct Guardian {
        address guardianAddress;
        euint32 encryptedShare;
        bool isActive;
    }

    struct RecoveryRequest {
        uint256 requestId;
        address requester;
        euint32[] encryptedShares;
        euint32 encryptedThreshold;
        bool isApproved;
        bool isRevealed;
    }

    struct DecryptedRecovery {
        uint32[] shares;
        uint32 threshold;
        bool isRevealed;
    }

    mapping(address => Guardian[]) public walletGuardians;
    mapping(address => RecoveryRequest[]) public recoveryRequests;
    mapping(address => DecryptedRecovery[]) public decryptedRecoveries;
    
    uint256 public requestCount;
    address public admin;
    
    event GuardianAdded(address indexed wallet, address indexed guardian);
    event RecoveryInitiated(address indexed wallet, uint256 indexed requestId);
    event RecoveryApproved(address indexed wallet, uint256 indexed requestId);
    event RecoveryCompleted(address indexed wallet, uint256 indexed requestId);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Admin only");
        _;
    }

    function addGuardian(
        address wallet,
        address guardian,
        euint32 share
    ) public onlyAdmin {
        walletGuardians[wallet].push(Guardian({
            guardianAddress: guardian,
            encryptedShare: share,
            isActive: true
        }));
        emit GuardianAdded(wallet, guardian);
    }

    function initiateRecovery(
        euint32[] memory shares,
        euint32 threshold
    ) public returns (uint256) {
        require(shares.length >= 3, "Minimum 3 shares required");
        
        requestCount++;
        uint256 requestId = requestCount;
        
        recoveryRequests[msg.sender].push(RecoveryRequest({
            requestId: requestId,
            requester: msg.sender,
            encryptedShares: shares,
            encryptedThreshold: threshold,
            isApproved: false,
            isRevealed: false
        }));
        
        emit RecoveryInitiated(msg.sender, requestId);
        return requestId;
    }

    function approveRecovery(
        address wallet,
        uint256 requestId,
        euint32 share
    ) public {
        require(requestId <= requestCount, "Invalid request ID");
        
        bool isGuardian = false;
        for (uint256 i = 0; i < walletGuardians[wallet].length; i++) {
            if (walletGuardians[wallet][i].guardianAddress == msg.sender) {
                isGuardian = true;
                break;
            }
        }
        require(isGuardian, "Not a guardian");
        
        RecoveryRequest storage request = recoveryRequests[wallet][requestId-1];
        request.encryptedShares.push(share);
        
        if (FHE.gt(FHE.asEuint32(uint32(request.encryptedShares.length)), request.encryptedThreshold)) {
            request.isApproved = true;
            emit RecoveryApproved(wallet, requestId);
        }
    }

    function completeRecovery(uint256 requestId) public {
        require(requestId <= requestCount, "Invalid request ID");
        RecoveryRequest storage request = recoveryRequests[msg.sender][requestId-1];
        require(request.isApproved, "Not enough approvals");
        require(!request.isRevealed, "Already completed");
        
        bytes32[] memory ciphertexts = new bytes32[](request.encryptedShares.length + 1);
        for (uint256 i = 0; i < request.encryptedShares.length; i++) {
            ciphertexts[i] = FHE.toBytes32(request.encryptedShares[i]);
        }
        ciphertexts[request.encryptedShares.length] = FHE.toBytes32(request.encryptedThreshold);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptRecovery.selector);
    }

    function decryptRecovery(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        address wallet = msg.sender;
        uint256 recoveryId = recoveryRequests[wallet].length - 1;
        
        uint32[] memory shares = new uint32[](results.length - 1);
        for (uint256 i = 0; i < shares.length; i++) {
            shares[i] = results[i];
        }
        
        decryptedRecoveries[wallet].push(DecryptedRecovery({
            shares: shares,
            threshold: results[results.length - 1],
            isRevealed: true
        }));
        
        recoveryRequests[wallet][recoveryId].isRevealed = true;
        emit RecoveryCompleted(wallet, recoveryId);
    }

    function verifyGuardianShare(
        address wallet,
        address guardian,
        euint32 share
    ) public view returns (ebool) {
        for (uint256 i = 0; i < walletGuardians[wallet].length; i++) {
            if (walletGuardians[wallet][i].guardianAddress == guardian) {
                return FHE.eq(walletGuardians[wallet][i].encryptedShare, share);
            }
        }
        return FHE.asEbool(false);
    }

    function getGuardianCount(address wallet) public view returns (uint256) {
        return walletGuardians[wallet].length;
    }

    function getRecoveryRequestCount(address wallet) public view returns (uint256) {
        return recoveryRequests[wallet].length;
    }

    function getDecryptedRecovery(address wallet, uint256 recoveryId) public view returns (
        uint32[] memory shares,
        uint32 threshold,
        bool isRevealed
    ) {
        require(recoveryId < decryptedRecoveries[wallet].length, "Invalid recovery ID");
        DecryptedRecovery storage recovery = decryptedRecoveries[wallet][recoveryId];
        return (recovery.shares, recovery.threshold, recovery.isRevealed);
    }
}