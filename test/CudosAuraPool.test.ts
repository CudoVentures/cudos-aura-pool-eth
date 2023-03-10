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
            await expect(cudosAuraPool.sendPayment(cudosAddr, { value: amount }))
                .emit(cudosAuraPool, "NftMinted")
                .withArgs(1, nftId, amount, admin.address, cudosAddr)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [-amount, amount]);

            const payment = await cudosAuraPool.payments(1);

            expect({
                id: payment.paymentId,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: 1,
                payee: admin.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: ethers.utils.hexlify(cudosAddr),
            });
        });

        it("empty cudosAddress", async () => {
            await expect(cudosAuraPool.sendPayment(empty, { value: amount })).revertedWith(
                "CudosAddress cannot be empty!"
            );
        });
        it("zero amount", async () => {
            await expect(cudosAuraPool.sendPayment(cudosAddr)).revertedWith(
                "Amount must be positive!"
            );
        });
    });

    describe("unlockPaymentWithdraw()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.unlockPaymentWithdraw(1))
                .emit(cudosAuraPool, "WithdrawalsUnlocked")
                .withArgs(1);

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("not relayer", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, { value: amount });

            await expect(cudosAuraPool.connect(user).unlockPaymentWithdraw(1)).revertedWith(
                "Msg sender not the relayer."
            );
        });

        it("not relayer after relayerAddress change", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, { value: amount });

            await cudosAuraPool.setRelayerAddress(user.address);

            await expect(cudosAuraPool.unlockPaymentWithdraw(1)).revertedWith(
                "Msg sender not the relayer."
            );
        });

        it("not locked status", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, { value: amount });

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
            await cudosAuraPool.connect(user).sendPayment(cudosAddr, {
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
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });

            await cudosAuraPool.unlockPaymentWithdraw(1);

            await expect(cudosAuraPool.connect(user).withdrawPayments()).revertedWith(
                "no payments for that address"
            );

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("payment not withdrawable", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });

            await expect(cudosAuraPool.withdrawPayments()).revertedWith(
                "Nothing to withdraw"
            );
        });
    });


    describe("withdrawFinishedPayments()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Locked);
            expect(await cudosAuraPool.getPaymentStatus(2)).equal(PaymentStatus.Locked);
            expect(await cudosAuraPool.getPaymentStatus(3)).equal(PaymentStatus.Locked);

            await cudosAuraPool.unlockPaymentWithdraw(1);
            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);

            await expect(cudosAuraPool.withdrawPayments()).emit(cudosAuraPool, "PaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [amount, -amount]);;

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Returned);

            await cudosAuraPool.unlockPaymentWithdraw(2);
            expect(await cudosAuraPool.getPaymentStatus(2)).equal(PaymentStatus.Withdrawable);
            expect(await cudosAuraPool.getPaymentStatus(3)).equal(PaymentStatus.Locked);

            await expect(cudosAuraPool.withdrawFinishedPayments(amount))
                .emit(cudosAuraPool, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [amount, -amount]);

            const balance = await cudosAuraPool.provider.getBalance(cudosAuraPool.address);

            expect(balance).equal(amount);

            await expect(cudosAuraPool.withdrawFinishedPayments(amount)).revertedWith(
                "Amount > available"
            );

            await expect(cudosAuraPool.withdrawPayments())
                .emit(cudosAuraPool, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosAuraPool], [amount, -amount]);

            const balancelast = await cudosAuraPool.provider.getBalance(cudosAuraPool.address);

            expect(balancelast).equal(ethers.utils.parseEther("0"));
        });

        it("withdrawable payment nto included", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, {
                value: amount,
            });

            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Locked);

            await cudosAuraPool.unlockPaymentWithdraw(1);
            expect(await cudosAuraPool.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);

            const balance = await cudosAuraPool.provider.getBalance(cudosAuraPool.address);
            expect(balance).equal(amount);

            await expect(cudosAuraPool.withdrawFinishedPayments(amount)).revertedWith(
                "Amount > available"
            )
        });

        it("not admin", async () => {
            await expect(cudosAuraPool.connect(user).withdrawFinishedPayments(amount)).revertedWith(
                "Recipient is not an admin!"
            );
        });
    });

    describe("getPaymentStatus()", () => {
        it("valid", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, { value: amount });

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
            await cudosAuraPool.connect(user).sendPayment(cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(1);

            const payment = payments[0];

            expect({
                id: payment.paymentId,
                payee: payment.payee,
                amount: payment.amount,
                status: payment.status,
                cudosAddress: payment.cudosAddress,
            }).eql({
                id: 1,
                payee: user.address,
                amount: amount,
                status: PaymentStatus.Locked,
                cudosAddress: ethers.utils.hexlify(cudosAddr),
            });
        });

        it("no payments", async () => {
            await cudosAuraPool.sendPayment(cudosAddr, { value: amount });

            const payments = await cudosAuraPool.connect(user).getPayments();
            expect(payments).length(0);
        });
    });

    describe("setRelayerAddress()", () => {
        it("happy path", async () => {
            await expect(cudosAuraPool.setRelayerAddress(user.address))
                .emit(cudosAuraPool, "ChangedRelayerAddress")
                .withArgs(user.address);
        })

        it("not admin", async () => {
            await expect(cudosAuraPool.connect(user).setRelayerAddress(user.address))
                .revertedWith(
                    "Recipient is not an admin!"
                );
        })
    })
});
