import { expect } from "chai";
import { utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
    CudosAuraPool__factory,
    CudosAuraPool,
    CudosAccessControls__factory,
} from "../typechain-types";

describe("CudosAuraPool", () => {
    let admin: SignerWithAddress;
    let user: SignerWithAddress;
    let cudosAuraPool: CudosAuraPool;

    const id = ethers.utils.formatBytes32String("1234567890");
    const cudosAddr = ethers.utils.formatBytes32String("1234567890");
    const empty = ethers.utils.formatBytes32String("");
    const amount = ethers.utils.parseEther("0.00000000001");

    enum PaymentStatus {
        Locked,
        Withdrawable,
        Returned,
        Finished,
        Withdrawn,
    }

    beforeEach(async () => {
        [admin, user] = await ethers.getSigners();

        const cudosAccessControls = await new CudosAccessControls__factory(admin).deploy();
        await cudosAccessControls.deployed();

        cudosAuraPool = await new CudosAuraPool__factory(admin).deploy(cudosAccessControls.address);
        await cudosAuraPool.deployed();

        await cudosAccessControls.addAdminRole(cudosAuraPool.address);
    });

    describe("constructor()", () => {
        it("zero address cudosAccessControls", async () => {
            await expect(
                new CudosAuraPool__factory(admin).deploy(ethers.constants.AddressZero)
            ).revertedWith("Invalid CudosAccessControls address!");
        });
    });

    describe("sendPayment()", () => {
        it("valid", async () => {
            await expect(cudosAuraPool.sendPayment(id, cudosAddr, { value: amount }))
                .emit(cudosAuraPool, "NftMinted")
                .withArgs(id, amount, admin.address, cudosAddr)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [-amount, amount]);

            const payment = await cudosAuraPool.payments(id);

            expect({
                id: payment.id,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: id,
                payee: admin.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: cudosAddr,
            });
        });

        it("dublicate paymentId", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await expect(cudosAuraPool.sendPayment(id, cudosAddr, { value: amount })).revertedWith(
                "PaymentId already used!"
            );
        });

        it("empty paymentId", async () => {
            await expect(
                cudosAuraPool.sendPayment(empty, cudosAddr, { value: amount })
            ).revertedWith("PaymentId cannot be empty!");
        });
        it("empty cudosAddress", async () => {
            await expect(cudosAuraPool.sendPayment(id, empty, { value: amount })).revertedWith(
                "CudosAddress cannot be empty!"
            );
        });
        it("zero amount", async () => {
            await expect(cudosAuraPool.sendPayment(id, cudosAddr)).revertedWith(
                "Amount must be positive!"
            );
        });
    });

    describe("unlockPaymentWithdraw()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.unlockPaymentWithdraw(id))
                .emit(cudosAuraPool, "WithdrawalsUnlocked")
                .withArgs(id);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Withdrawable);
        });

        it("not admin", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await expect(cudosAuraPool.connect(user).unlockPaymentWithdraw(id)).revertedWith(
                "Recipient is not an admin!"
            );
        });

        it("not locked status", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(id);

            await expect(cudosAuraPool.unlockPaymentWithdraw(id)).revertedWith(
                "Payment is not locked!"
            );
        });

        it("not existing payment", async () => {
            await expect(cudosAuraPool.unlockPaymentWithdraw(id)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("withdrawPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(id, cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.unlockPaymentWithdraw(id);

            await expect(cudosAuraPool.connect(user).withdrawPayments())
                .emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosAuraPool], [amount, -amount]);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Returned);
        });

        it("nothing to withdraw", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.unlockPaymentWithdraw(id);

            await expect(cudosAuraPool.connect(user).withdrawPayments())
                .emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosAuraPool], [0, 0]);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Withdrawable);
        });

        it("payment not withdrawable", async () => {
            await cudosAuraPool.connect(user).sendPayment(id, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.withdrawPayments())
                .emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosAuraPool], [0, 0]);
        });
    });

    describe("markPaymentFinished()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.markPaymentFinished(id))
                .emit(cudosAuraPool, "MarkedAsFinished")
                .withArgs(id);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Finished);
        });

        it("not admin", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await expect(cudosAuraPool.connect(user).markPaymentFinished(id)).revertedWith(
                "Recipient is not an admin!"
            );
        });

        it("not locked status", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(id);

            await expect(cudosAuraPool.markPaymentFinished(id)).revertedWith("Payment not locked!");
        });

        it("not existing payment", async () => {
            await expect(cudosAuraPool.markPaymentFinished(id)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("withdrawFinishedPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(id, cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.markPaymentFinished(id);

            await expect(cudosAuraPool.withdrawFinishedPayments())
                .emit(cudosAuraPool, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [amount, -amount]);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Withdrawn);
        });

        it("payment not finished", async () => {
            await cudosAuraPool.connect(user).sendPayment(id, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.withdrawFinishedPayments())
                .emit(cudosAuraPool, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [0, 0]);
        });

        it("not admin", async () => {
            await expect(cudosAuraPool.connect(user).withdrawFinishedPayments()).revertedWith(
                "Recipient is not an admin!"
            );
        });
    });

    describe("getPaymentStatus()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(id);

            expect(await cudosAuraPool.getPaymentStatus(id)).equal(PaymentStatus.Withdrawable);
        });

        it("not existing paymentId", async () => {
            await expect(cudosAuraPool.getPaymentStatus(id)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("getPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(id, cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(1);

            const payment = payments[0];

            expect({
                id: payment.id,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: id,
                payee: user.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: cudosAddr,
            });
        });

        it("no payments", async () => {
            await cudosAuraPool.sendPayment(id, cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(0);
        });
    });
});
