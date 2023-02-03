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

    const nftId = ethers.utils.toUtf8Bytes("7a00c0e9-0187-4652-9166-8cb55f611411");
    const cudosAddr = ethers.utils.toUtf8Bytes("cudos1xcnugwrzfxvp0fzuz9uj9x5u4pq44w4knelcgx");
    const empty = ethers.utils.toUtf8Bytes("");

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
            await expect(cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount }))
                .emit(cudosAuraPool, "NftMinted")
                .withArgs(1, nftId, amount, admin.address, cudosAddr)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [-amount, amount]);

            const payment = await cudosAuraPool.payments(1);

            expect({
                id: payment.paymentId,
                nftId: payment.nftId,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: 1,
                nftId: ethers.utils.hexlify(nftId),
                payee: admin.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: ethers.utils.hexlify(cudosAddr),
            });
        });

        it("dublicate paymentId", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await expect(cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount })).revertedWith(
                "NftId minted or pending!"
            );
        });

        it("dublicate paymentId after payment finished", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await expect(cudosAuraPool.markPaymentFinished(1))
            .emit(cudosAuraPool, "MarkedAsFinished")
            .withArgs(1);
            
            await expect(cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount })).revertedWith(
                "NftId minted or pending!"
            );
        });

        it("dublicate paymentId after withdraw unlock", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await expect(cudosAuraPool.unlockPaymentWithdraw(1))
                .emit(cudosAuraPool, "WithdrawalsUnlocked")
                .withArgs(1);

            await expect(cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount }))
                .emit(cudosAuraPool, "NftMinted")
                .withArgs(2, nftId, amount, admin.address, cudosAddr)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [-amount, amount]);

            const payment = await cudosAuraPool.payments(2);

            expect({
                id: payment.paymentId,
                nftId: payment.nftId,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: 2,
                nftId: ethers.utils.hexlify(nftId),
                payee: admin.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: ethers.utils.hexlify(cudosAddr),
            });
        });

        it("empty paymentId", async () => {
            await expect(
                cudosAuraPool.sendPayment(empty, cudosAddr, { value: amount })
            ).revertedWith("NftId cannot be empty!");
        });
        it("empty cudosAddress", async () => {
            await expect(cudosAuraPool.sendPayment(nftId, empty, { value: amount })).revertedWith(
                "CudosAddress cannot be empty!"
            );
        });
        it("zero amount", async () => {
            await expect(cudosAuraPool.sendPayment(nftId, cudosAddr)).revertedWith(
                "Amount must be positive!"
            );
        });
    });

    describe("unlockPaymentWithdraw()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.unlockPaymentWithdraw(1))
                .emit(cudosAuraPool, "WithdrawalsUnlocked")
                .withArgs(1);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("not admin", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await expect(cudosAuraPool.connect(user).unlockPaymentWithdraw(1)).revertedWith(
                "Recipient is not an admin!"
            );
        });

        it("not locked status", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            await expect(cudosAuraPool.unlockPaymentWithdraw(1)).revertedWith(
                "Payment is not locked!"
            );
        });

        it("not existing payment", async () => {
            await expect(cudosAuraPool.unlockPaymentWithdraw(1)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("withdrawPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(nftId, cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            await expect(cudosAuraPool.connect(user).withdrawPayments())
                .emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosAuraPool], [amount, -amount]);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Returned);
        });

        it("nothing to withdraw", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            await expect(cudosAuraPool.connect(user).withdrawPayments())
                .emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosAuraPool], [0, 0]);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("payment not withdrawable", async () => {
            await cudosAuraPool.connect(user).sendPayment(nftId, cudosAddr, {
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
            await cudosAuraPool.sendPayment(nftId, cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.markPaymentFinished(1))
                .emit(cudosAuraPool, "MarkedAsFinished")
                .withArgs(1);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Finished);
        });

        it("not admin", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await expect(cudosAuraPool.connect(user).markPaymentFinished(1)).revertedWith(
                "Recipient is not an admin!"
            );
        });

        it("not locked status", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            await expect(cudosAuraPool.markPaymentFinished(1)).revertedWith("Payment not locked!");
        });

        it("not existing payment", async () => {
            await expect(cudosAuraPool.markPaymentFinished(1)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("withdrawFinishedPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(nftId, cudosAddr, {
                value: amount,
            });

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Locked);

            await cudosAuraPool.markPaymentFinished(1);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Finished);

            await expect(cudosAuraPool.withdrawFinishedPayments())
                .emit(cudosAuraPool, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [amount, -amount]);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawn);
        });

        it("payment not finished", async () => {
            await cudosAuraPool.connect(user).sendPayment(nftId, cudosAddr, {
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
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("not existing paymentId", async () => {
            await expect(cudosAuraPool.getPaymentStatus(1)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("getPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.connect(user).sendPayment(nftId, cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(1);

            const payment = payments[0];

            expect({
                id: payment.paymentId,
                nftId: payment.nftId,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: 1,
                nftId: ethers.utils.hexlify(nftId),
                payee: user.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: ethers.utils.hexlify(cudosAddr),
            });
        });

        it("no payments", async () => {
            await cudosAuraPool.sendPayment(nftId, cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(0);
        });
    });
});
