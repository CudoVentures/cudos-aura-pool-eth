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
        bytes32 id;
        address payee;
        uint256 amount;
        PaymentStatus status;
        bytes32 cudosAddress;
    }

    enum PaymentStatus {
        Locked,
        Withdrawable,
        Returned,
        Finished,
        Withdrawn
    }

    CudosAccessControls public immutable cudosAccessControls;
    mapping(bytes32 => Payment) public payments;
    mapping(address => bytes32[]) public paymentIdsByAddress;
    bytes32[] public paymentIds;

    event NftMinted(
        bytes32 paymentId,
        uint256 amount,
        address indexed sender,
        bytes32 cudosAddress
    );
    event WithdrawalsUnlocked(bytes32 paymentId);
    event MarkedAsFinished(bytes32 paymentId);
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
    }

    function sendPayment(bytes32 paymentId, bytes32 cudosAddress)
        external
        payable
        nonReentrant
    {
        require(msg.value > 0, "Amount must be positive!");
        require(payments[paymentId].amount == 0, "PaymentId already used!");
        require(paymentId != bytes32(0), "PaymentId cannot be empty!");
        require(cudosAddress != bytes32(0), "CudosAddress cannot be empty!");

        Payment storage payment = payments[paymentId];
        payment.id = paymentId;
        payment.payee = msg.sender;
        payment.amount = msg.value;
        payment.cudosAddress = cudosAddress;

        paymentIdsByAddress[msg.sender].push(paymentId);
        paymentIds.push(paymentId);

        emit NftMinted(paymentId, msg.value, msg.sender, cudosAddress);
    }

    function unlockPaymentWithdraw(bytes32 paymentId)
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

        emit WithdrawalsUnlocked(paymentId);
    }

    function withdrawPayments() external nonReentrant {
        if (paymentIdsByAddress[msg.sender].length == 0) {
            return;
        }

        bytes32[] memory ids = paymentIdsByAddress[msg.sender];
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

    function markPaymentFinished(bytes32 paymentId)
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
        for (uint256 i = 0; i < paymentIds.length; ++i) {
            Payment storage payment = payments[paymentIds[i]];
            if (payment.status != PaymentStatus.Finished) {
                continue;
            }

            totalAmount += payment.amount;
            payment.status = PaymentStatus.Withdrawn;
        }

        payable(msg.sender).transfer(totalAmount);

        emit FinishedPaymentsWithdrawn(msg.sender);
    }

    function getPaymentStatus(bytes32 paymentId)
        external
        view
        returns (PaymentStatus)
    {
        require(payments[paymentId].amount > 0, "Non existing paymentId!");

        return payments[paymentId].status;
    }

    function getPayments() external view returns (Payment[] memory) {
        bytes32[] memory ids = paymentIdsByAddress[msg.sender];
        Payment[] memory paymentsFiltered = new Payment[](ids.length);

        for (uint256 i = 0; i < ids.length; ++i) {
            paymentsFiltered[i] = payments[ids[i]];
        }

        return paymentsFiltered;
    }
}
