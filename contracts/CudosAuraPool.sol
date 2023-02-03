// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./CudosAccessControls.sol";
import "hardhat/console.sol";

contract CudosAuraPool is ReentrancyGuard {
    using SafeMath for uint256;

    struct Payment {
        uint32 paymentId;
        bytes nftId;
        address payee;
        uint256 amount;
        PaymentStatus status;
        bytes cudosAddress;
    }

    enum PaymentStatus {
        Locked,
        Withdrawable,
        Returned,
        Finished,
        Withdrawn
    }

    CudosAccessControls public immutable cudosAccessControls;
    mapping(uint32 => Payment) public payments;
    mapping(address => uint32[]) public paymentIdsByAddress;
    mapping(bytes => bool) public pendingNftIds;
    
    uint32 private nextPaymentId;

    event NftMinted(
        uint32 paymentId,
        bytes nftId,
        uint256 amount,
        address indexed sender,
        bytes cudosAddress
    );
    event WithdrawalsUnlocked(uint32 paymentId);
    event MarkedAsFinished(uint32 paymentId);
    event PaymentsWithdrawn(address payee);
    event FinishedPaymentsWithdrawn(address withdrawer);

    modifier onlyAdmin() {
        require(
            cudosAccessControls.hasAdminRole(msg.sender),
            "Recipient is not an admin!"
        );
        _;
    }

    constructor(CudosAccessControls _cudosAccessControls) payable {
        require(
            address(_cudosAccessControls) != address(0) &&
                Address.isContract(address(_cudosAccessControls)),
            "Invalid CudosAccessControls address!"
        );
        cudosAccessControls = _cudosAccessControls;
        nextPaymentId = 1;
    }

    function sendPayment(bytes memory nftId, bytes memory cudosAddress)
        external
        payable
        nonReentrant
    {
        require(msg.value > 0, "Amount must be positive!");
        require(nftId.length != 0, "NftId cannot be empty!");
        require(cudosAddress.length != 0, "CudosAddress cannot be empty!");
        require(pendingNftIds[nftId] == false, "NftId minted or pending!");

        Payment storage payment = payments[nextPaymentId];
        payment.paymentId = nextPaymentId;
        payment.nftId = nftId;
        payment.payee = msg.sender;
        payment.amount = msg.value;
        payment.cudosAddress = cudosAddress;

        paymentIdsByAddress[msg.sender].push(nextPaymentId);
        pendingNftIds[nftId] = true;
        nextPaymentId += 1;

        emit NftMinted(payment.paymentId , nftId, msg.value, msg.sender, cudosAddress);
    }

    function unlockPaymentWithdraw(uint32 paymentId)
        external
        onlyAdmin
        nonReentrant
    {
        require(payments[paymentId].amount > 0, "Non existing paymentId!");
        require(
            payments[paymentId].status == PaymentStatus.Locked,
            "Payment is not locked!"
        );
        payments[paymentId].status = PaymentStatus.Withdrawable;
        pendingNftIds[payments[paymentId].nftId] = false;
        
        emit WithdrawalsUnlocked(paymentId);
    }

    function withdrawPayments() external nonReentrant {
        if (paymentIdsByAddress[msg.sender].length == 0) {
            return;
        }

        uint32[] memory ids = paymentIdsByAddress[msg.sender];
        uint256 totalAmount;
        for (uint256 i = 0; i < ids.length; ++i) {
            Payment storage payment = payments[ids[i]];
            if (payment.status != PaymentStatus.Withdrawable) {
                continue;
            }

            totalAmount += payment.amount;
            payment.status = PaymentStatus.Returned;
        }

        payable(msg.sender).transfer(totalAmount);

        emit PaymentsWithdrawn(msg.sender);
    }

    function markPaymentFinished(uint32 paymentId)
        external
        onlyAdmin
        nonReentrant
    {
        require(payments[paymentId].amount > 0, "Non existing paymentId!");
        require(
            payments[paymentId].status == PaymentStatus.Locked,
            "Payment not locked!"
        );
        payments[paymentId].status = PaymentStatus.Finished;

        emit MarkedAsFinished(paymentId);
    }

    function withdrawFinishedPayments() external onlyAdmin nonReentrant {
        uint256 totalAmount;
        for (uint32 i = 1; i < nextPaymentId; ++i) {
            Payment storage payment = payments[i];
            if (payment.status != PaymentStatus.Finished) {
                continue;
            }

            totalAmount += payment.amount;
            payment.status = PaymentStatus.Withdrawn;
        }

        payable(msg.sender).transfer(totalAmount);

        emit FinishedPaymentsWithdrawn(msg.sender);
    }

    function getPaymentStatus(uint32 paymentId)
        external
        view
        returns (PaymentStatus)
    {
        require(payments[paymentId].amount > 0, "Non existing paymentId!");

        return payments[paymentId].status;
    }

    function getPayments() external view returns (Payment[] memory) {
        uint32[] memory ids = paymentIdsByAddress[msg.sender];
        Payment[] memory paymentsFiltered = new Payment[](ids.length);

        for (uint256 i = 0; i < ids.length; ++i) {
            paymentsFiltered[i] = payments[ids[i]];
        }

        return paymentsFiltered;
    }
}
