import { expect } from "chai";
import { utils } from "ethers";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
    CudosMarkets__factory,
    CudosMarkets,
    CudosAccessControls__factory,
} from "../typechain-types";

describe("CudosMarkets", () => {
    let admin: SignerWithAddress;
    let user: SignerWithAddress;
    let cudosMarkets: CudosMarkets;

    const nftId = ethers.utils.toUtf8Bytes("7a00c0e9-0187-4652-9166-8cb55f611411");
    const cudosAddr = ethers.utils.toUtf8Bytes("cudos1xcnugwrzfxvp0fzuz9uj9x5u4pq44w4knelcgx");
    const empty = ethers.utils.toUtf8Bytes("");

    const amount = ethers.utils.parseEther("0.00000000001");

    enum PaymentStatus {
        Locked,
        Withdrawable,
        Returned,
        Withdrawn
    }

    beforeEach(async () => {
        [admin, user] = await ethers.getSigners();

        const cudosAccessControls = await new CudosAccessControls__factory(admin).deploy();
        await cudosAccessControls.deployed();

        cudosMarkets = await new CudosMarkets__factory(admin).deploy(cudosAccessControls.address);
        await cudosMarkets.deployed();

        await cudosAccessControls.addAdminRole(cudosMarkets.address);
    });

    describe("constructor()", () => {
        it("zero address cudosAccessControls", async () => {
            await expect(
                new CudosMarkets__factory(admin).deploy(ethers.constants.AddressZero)
            ).revertedWith("Invalid CudosAccessControls address!");
        });
    });

    describe("sendPayment()", () => {
        it("valid", async () => {
            await expect(cudosMarkets.sendPayment(cudosAddr, { value: amount }))
                .emit(cudosMarkets, "NftMinted")
                .withArgs(1, nftId, amount, admin.address, cudosAddr)
                .and.to.changeEtherBalances([admin, cudosMarkets], [-amount, amount]);

            const payment = await cudosMarkets.payments(1);

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
            await expect(cudosMarkets.sendPayment(empty, { value: amount })).revertedWith(
                "CudosAddress cannot be empty!"
            );
        });
        it("zero amount", async () => {
            await expect(cudosMarkets.sendPayment(cudosAddr)).revertedWith(
                "Amount must be positive!"
            );
        });
    });

    describe("unlockPaymentWithdraw()", () => {
        it("valid", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });

            await expect(cudosMarkets.unlockPaymentWithdraw(1))
                .emit(cudosMarkets, "WithdrawalsUnlocked")
                .withArgs(1);

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("not relayer", async () => {
            await cudosMarkets.sendPayment(cudosAddr, { value: amount });

            await expect(cudosMarkets.connect(user).unlockPaymentWithdraw(1)).revertedWith(
                "Msg sender not the relayer."
            );
        });

        it("not relayer after relayerAddress change", async () => {
            await cudosMarkets.sendPayment(cudosAddr, { value: amount });

            await cudosMarkets.setRelayerAddress(user.address);

            await expect(cudosMarkets.unlockPaymentWithdraw(1)).revertedWith(
                "Msg sender not the relayer."
            );
        });

        it("not locked status", async () => {
            await cudosMarkets.sendPayment(cudosAddr, { value: amount });

            await cudosMarkets.unlockPaymentWithdraw(1);

            await expect(cudosMarkets.unlockPaymentWithdraw(1)).revertedWith(
                "Payment is not locked!"
            );
        });

        it("not existing payment", async () => {
            await expect(cudosMarkets.unlockPaymentWithdraw(1)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("withdrawPayments()", () => {
        it("valid", async () => {
            await cudosMarkets.connect(user).sendPayment(cudosAddr, {
                value: amount,
            });

            await cudosMarkets.unlockPaymentWithdraw(1);

            await expect(cudosMarkets.connect(user).withdrawPayments())
                .emit(cudosMarkets, "PaymentsWithdrawn")
                .withArgs(user.address)
                .and.to.changeEtherBalances([user, cudosMarkets], [amount, -amount]);

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Returned);
        });

        it("nothing to withdraw", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });

            await cudosMarkets.unlockPaymentWithdraw(1);

            await expect(cudosMarkets.connect(user).withdrawPayments()).revertedWith(
                "no payments for that address"
            );

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("payment not withdrawable", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });

            await expect(cudosMarkets.withdrawPayments()).revertedWith(
                "Nothing to withdraw"
            );
        });
    });


    describe("withdrawFinishedPayments()", () => {
        it("valid", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Locked);
            expect(await cudosMarkets.getPaymentStatus(2)).equal(PaymentStatus.Locked);
            expect(await cudosMarkets.getPaymentStatus(3)).equal(PaymentStatus.Locked);

            await cudosMarkets.unlockPaymentWithdraw(1);
            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);

            await expect(cudosMarkets.withdrawPayments()).emit(cudosMarkets, "PaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosMarkets], [amount, -amount]);;

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Returned);

            await cudosMarkets.unlockPaymentWithdraw(2);
            expect(await cudosMarkets.getPaymentStatus(2)).equal(PaymentStatus.Withdrawable);
            expect(await cudosMarkets.getPaymentStatus(3)).equal(PaymentStatus.Locked);

            await expect(cudosMarkets.withdrawFinishedPayments())
                .emit(cudosMarkets, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosMarkets], [amount, -amount]);

            const balance = await cudosMarkets.provider.getBalance(cudosMarkets.address);

            expect(balance).equal(amount);

            await expect(cudosMarkets.withdrawPayments())
                .emit(cudosMarkets, "PaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosMarkets], [amount, -amount]);

            const balancelast = await cudosMarkets.provider.getBalance(cudosMarkets.address);

            expect(balancelast).equal(ethers.utils.parseEther("0"));
        });

        it("withdrawable payment not included", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Locked);

            await cudosMarkets.unlockPaymentWithdraw(1);
            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);

            const balance = await cudosMarkets.provider.getBalance(cudosMarkets.address);
            expect(balance).equal(amount);

            await expect(cudosMarkets.withdrawFinishedPayments()).revertedWith(
                "Nothing to withdraw"
            )
        });
        it("withdrawn payment not included", async () => {
            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });
            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Locked);

            await expect(cudosMarkets.withdrawFinishedPayments())
                .emit(cudosMarkets, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosMarkets], [amount, -amount]);

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawn);

            await cudosMarkets.sendPayment(cudosAddr, {
                value: amount,
            });
            expect(await cudosMarkets.getPaymentStatus(2)).equal(PaymentStatus.Locked);

            await expect(cudosMarkets.withdrawFinishedPayments())
                .emit(cudosMarkets, "FinishedPaymentsWithdrawn")
                .withArgs(admin.address)
                .and.to.changeEtherBalances([admin, cudosMarkets], [amount, -amount]);

            expect(await cudosMarkets.getPaymentStatus(2)).equal(PaymentStatus.Withdrawn);

            await expect(cudosMarkets.withdrawFinishedPayments()).revertedWith(
                "Nothing to withdraw"
            )
        });

        it("not admin", async () => {
            await expect(cudosMarkets.connect(user).withdrawFinishedPayments()).revertedWith(
                "Recipient is not an admin!"
            );
        });
    });

    describe("getPaymentStatus()", () => {
        it("valid", async () => {
            await cudosMarkets.sendPayment(cudosAddr, { value: amount });

            await cudosMarkets.unlockPaymentWithdraw(1);

            expect(await cudosMarkets.getPaymentStatus(1)).equal(PaymentStatus.Withdrawable);
        });

        it("not existing paymentId", async () => {
            await expect(cudosMarkets.getPaymentStatus(1)).revertedWith(
                "Non existing paymentId!"
            );
        });
    });

    describe("getPayments()", () => {
        it("valid", async () => {
            await cudosMarkets.connect(user).sendPayment(cudosAddr, { value: amount });

            const payments = await cudosMarkets.connect(user).getPayments();
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
            await cudosMarkets.sendPayment(cudosAddr, { value: amount });

            const payments = await cudosMarkets.connect(user).getPayments();
            expect(payments).length(0);
        });
    });

    describe("setRelayerAddress()", () => {
        it("happy path", async () => {
            await expect(cudosMarkets.setRelayerAddress(user.address))
                .emit(cudosMarkets, "ChangedRelayerAddress")
                .withArgs(user.address);
        })

        it("not admin", async () => {
            await expect(cudosMarkets.connect(user).setRelayerAddress(user.address))
                .revertedWith(
                    "Recipient is not an admin!"
                );
        })
    })
});
