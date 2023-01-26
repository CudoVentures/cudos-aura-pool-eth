// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./CudosAccessControls.sol";

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
    bytes32[] public paymentIds;

    event NftMinted(
        bytes32 paymentId,
        uint256 amount,
        address sender,
        bytes32 cudosAddress
    );
    event WithdrawalsUnlocked(bytes32 paymentId);
    event MarkedAsFinished(bytes32 paymentId);
    event PaymentsWithdrawn(address payee);
    event FinishedPaymentsWithdrawn(address withdrawer);

    modifier onlyAdmin() {
        require(
            cudosAccessControls.hasAdminRole(msg.sender),
            "Recipient is not an admin"
        );
        _;
    }

    constructor(CudosAccessControls _cudosAccessControls) {
        cudosAccessControls = _cudosAccessControls;
    }

    function mintNft(bytes32 paymentId, bytes32 cudosAddress) external payable {
        require(msg.value > 0 wei, "Amount must be positive!");
        require(msg.sender.balance >= msg.value, "Insufficient balance!");
        require(paymentId.length > 0, "PaymentId cannot be empty!");
        require(cudosAddress.length > 0, "Cudos address cannot be empty!");
        require(payments[paymentId].id.length == 0, "PaymentId already used!");

        Payment storage payment = payments[paymentId];
        payment.id = paymentId;
        payment.payee = msg.sender;
        payment.amount = msg.value;
        payment.status = PaymentStatus.Locked;
        payment.cudosAddress = cudosAddress;

        paymentIds.push(paymentId);

        emit NftMinted(paymentId, msg.value, msg.sender, cudosAddress);
    }

    function unlockPaymentWithdraw(bytes32 paymentId) external onlyAdmin {
        payments[paymentId].status = PaymentStatus.Withdrawable;

        emit WithdrawalsUnlocked(paymentId);
    }

    function withdrawPayments() external {
        uint256 totalAmount;
        for (uint256 i; i < paymentIds.length; ++i) {
            Payment storage payment = payments[paymentIds[i]];
            if (
                payment.status != PaymentStatus.Withdrawable ||
                payment.payee != msg.sender
            ) {
                continue;
            }

            totalAmount += payment.amount;
            payment.status = PaymentStatus.Returned;
        }

        payable(msg.sender).transfer(totalAmount);

        emit PaymentsWithdrawn(msg.sender);
    }

    function markPaymentFinished(bytes32 paymentId) external onlyAdmin {
        payments[paymentId].status = PaymentStatus.Finished;

        emit MarkedAsFinished(paymentId);
    }

    function withdrawFinishedPayments() external onlyAdmin {
        uint256 totalAmount;
        for (uint256 i; i < paymentIds.length; ++i) {
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
        require(payments[paymentId].id.length > 0, "Non existing paymentId!");

        return payments[paymentId].status;
    }

    function getPayments() external view returns (Payment[] memory) {
        Payment[] memory paymentsRes = new Payment[](paymentIds.length);
        uint256 nextPaymentIndex = 0;

        for (uint256 i; i < paymentIds.length; ++i) {
            bytes32 paymentId = paymentIds[i];
            Payment memory payment = payments[paymentId];
            if (payment.payee != msg.sender) {
                continue;
            }

            paymentsRes[nextPaymentIndex] = payment;
            nextPaymentIndex++;
        }

        return paymentsRes;
    }
}
