use concordium_smart_contract_testing::*;
use concordium_std::Serial;
use surplus_bid::{
    winning_allocation, Commitment, Error, InitParams, Phase, RevealParams, StartParams,
};

const SELLER: AccountAddress = AccountAddress([0; 32]);
const A: AccountAddress = AccountAddress([1; 32]);
const B: AccountAddress = AccountAddress([2; 32]);
const C: AccountAddress = AccountAddress([3; 32]);
const D: AccountAddress = AccountAddress([4; 32]);
const PLATFORM: AccountAddress = AccountAddress([30; 32]);
const GUARANTEE: Amount = Amount::from_ccd(2);
const COMMIT_END: u64 = 1_000;
const REVEAL_END: u64 = 2_000;
const RESERVE_COMMITMENT: Commitment = [
    178, 143, 135, 28, 83, 104, 54, 217, 234, 157, 194, 108, 206, 238, 251, 124, 43,
    20, 235, 199, 130, 139, 74, 253, 92, 255, 220, 140, 135, 111, 111, 44,
];
const A_COMMITMENT: Commitment = [
    247, 27, 146, 246, 35, 211, 3, 241, 76, 202, 37, 42, 13, 204, 217, 143, 39,
    39, 192, 76, 8, 174, 53, 35, 115, 99, 53, 94, 167, 223, 94, 35,
];
const A_BELOW_RESERVE_COMMITMENT: Commitment = [
    157, 226, 14, 82, 197, 129, 203, 73, 1, 77, 229, 243, 163, 57, 124, 238, 54,
    192, 152, 21, 41, 101, 226, 185, 10, 77, 52, 14, 14, 149, 125, 58,
];
const A_TIE_COMMITMENT: Commitment = [
    131, 197, 159, 232, 209, 7, 143, 159, 77, 115, 210, 18, 42, 90, 123, 195, 123,
    86, 123, 138, 11, 175, 117, 59, 145, 237, 60, 210, 181, 222, 181, 186,
];
const B_COMMITMENT: Commitment = [
    133, 6, 240, 61, 246, 244, 167, 33, 228, 217, 152, 44, 188, 12, 166, 208,
    206, 217, 238, 2, 161, 224, 62, 140, 136, 206, 211, 85, 171, 226, 199, 127,
];
const B_FIVE_COMMITMENT: Commitment = [
    86, 116, 113, 174, 140, 122, 233, 91, 206, 50, 228, 243, 178, 86, 211, 82,
    137, 80, 156, 27, 35, 169, 128, 147, 144, 200, 165, 101, 188, 170, 253, 79,
];
const C_FIVE_COMMITMENT: Commitment = [
    100, 180, 127, 157, 153, 13, 8, 247, 204, 81, 167, 231, 211, 205, 35, 29,
    128, 79, 133, 153, 126, 104, 158, 144, 107, 148, 87, 236, 0, 171, 107, 22,
];
const C_TIE_COMMITMENT: Commitment = [
    191, 91, 4, 5, 126, 247, 124, 21, 230, 246, 227, 83, 153, 12, 205, 57, 195,
    129, 81, 226, 240, 130, 39, 64, 71, 117, 80, 100, 128, 54, 57, 174,
];
fn setup() -> (Chain, ContractAddress) {
    let mut chain = Chain::new();
    for account in [SELLER, A, B, C, D] {
        chain.create_account(Account::new(account, Amount::from_ccd(10_000)));
    }
    chain.create_account(Account::new(PLATFORM, Amount::zero()));
    let deployment = chain
        .module_deploy_v1(
            Signer::with_one_key(),
            SELLER,
            module_load_v1("module.wasm.v1").expect("load contract module"),
        )
        .expect("deploy contract module");
    let initialization = chain
        .contract_init(
            Signer::with_one_key(),
            SELLER,
            Energy::from(200_000),
            InitContractPayload {
                mod_ref: deployment.module_reference,
                init_name: OwnedContractName::new_unchecked("init_surplus_bid".into()),
                param: OwnedParameter::from_serial(&InitParams {
                    service_id: "priority-analysis-demo".into(),
                    guarantee: GUARANTEE,
                    fee_recipient: PLATFORM,
                })
                .expect("serialize init"),
                amount: Amount::zero(),
            },
        )
        .expect("initialize contract");
    (chain, initialization.contract_address)
}

fn update<T: Serial>(
    chain: &mut Chain,
    address: ContractAddress,
    account: AccountAddress,
    entrypoint: &str,
    parameter: &T,
    amount: Amount,
) -> Result<ContractInvokeSuccess, ContractInvokeError> {
    chain.contract_update(
        Signer::with_one_key(),
        account,
        Address::Account(account),
        Energy::from(500_000),
        UpdateContractPayload {
            address,
            receive_name: OwnedReceiveName::new_unchecked(format!(
                "surplus_bid.{entrypoint}"
            )),
            message: OwnedParameter::from_serial(parameter).expect("serialize update"),
            amount,
        },
    )
}

fn update_empty(
    chain: &mut Chain,
    address: ContractAddress,
    account: AccountAddress,
    entrypoint: &str,
) -> Result<ContractInvokeSuccess, ContractInvokeError> {
    chain.contract_update(
        Signer::with_one_key(),
        account,
        Address::Account(account),
        Energy::from(500_000),
        UpdateContractPayload {
            address,
            receive_name: OwnedReceiveName::new_unchecked(format!(
                "surplus_bid.{entrypoint}"
            )),
            message: OwnedParameter::empty(),
            amount: Amount::zero(),
        },
    )
}

fn commitment(
    reserve: bool,
    _address: ContractAddress,
    account: AccountAddress,
    amount: Amount,
    salt_byte: u8,
) -> Commitment {
    if reserve {
        assert_eq!((account, amount, salt_byte), (SELLER, Amount::from_ccd(2), 9));
        RESERVE_COMMITMENT
    } else if account == A {
        match (amount, salt_byte) {
            (amount, 1) if amount == Amount::from_ccd(4) => A_COMMITMENT,
            (amount, 3) if amount == Amount::from_ccd(1) => A_BELOW_RESERVE_COMMITMENT,
            (amount, 4) if amount == Amount::from_ccd(6) => A_TIE_COMMITMENT,
            _ => panic!("unsupported A commitment vector"),
        }
    } else if account == B {
        match (amount, salt_byte) {
            (amount, 2) if amount == Amount::from_ccd(6) => B_COMMITMENT,
            (amount, 2) if amount == Amount::from_ccd(5) => B_FIVE_COMMITMENT,
            _ => panic!("unsupported B commitment vector"),
        }
    } else if account == C {
        match (amount, salt_byte) {
            (amount, 3) if amount == Amount::from_ccd(5) => C_FIVE_COMMITMENT,
            (amount, 3) if amount == Amount::from_ccd(6) => C_TIE_COMMITMENT,
            _ => panic!("unsupported C commitment vector"),
        }
    } else {
        panic!("unsupported commitment account")
    }
}

fn start(
    chain: &mut Chain,
    address: ContractAddress,
    reserve: Amount,
) -> ContractInvokeSuccess {
    update(
        chain,
        address,
        SELLER,
        "start_round",
        &StartParams {
            reserve_commitment: commitment(true, address, SELLER, reserve, 9),
            commit_end: Timestamp::from_timestamp_millis(COMMIT_END),
            reveal_end: Timestamp::from_timestamp_millis(REVEAL_END),
        },
        GUARANTEE,
    )
    .expect("start round")
}

fn commit(
    chain: &mut Chain,
    address: ContractAddress,
    account: AccountAddress,
    bid: Amount,
    salt_byte: u8,
) -> ContractInvokeSuccess {
    update(
        chain,
        address,
        account,
        "commit_bid",
        &commitment(false, address, account, bid, salt_byte),
        GUARANTEE,
    )
    .expect("commit bid")
}

fn reveal_reserve(
    chain: &mut Chain,
    address: ContractAddress,
    reserve: Amount,
) -> ContractInvokeSuccess {
    update(
        chain,
        address,
        SELLER,
        "reveal_reserve",
        &RevealParams {
            amount: reserve,
            salt: [9; 32],
        },
        Amount::zero(),
    )
    .expect("reveal reserve")
}

fn reveal_bid(
    chain: &mut Chain,
    address: ContractAddress,
    account: AccountAddress,
    bid: Amount,
    salt_byte: u8,
) -> ContractInvokeSuccess {
    update(
        chain,
        address,
        account,
        "reveal_bid",
        &RevealParams {
            amount: bid,
            salt: [salt_byte; 32],
        },
        Amount::from_micro_ccd(bid.micro_ccd.saturating_sub(GUARANTEE.micro_ccd)),
    )
    .expect("reveal bid")
}

fn view(chain: &Chain, address: ContractAddress) -> surplus_bid::State {
    let result = chain
        .contract_invoke(
            SELLER,
            Address::Account(SELLER),
            Energy::from(100_000),
            UpdateContractPayload {
                address,
                receive_name: OwnedReceiveName::new_unchecked("surplus_bid.view".into()),
                message: OwnedParameter::empty(),
                amount: Amount::zero(),
            },
        )
        .expect("view contract");
    result.parse_return_value().expect("parse state")
}

fn balance(chain: &Chain, account: AccountAddress) -> Amount {
    chain
        .account_balance_available(account)
        .expect("account balance")
}

fn rejected(
    result: Result<ContractInvokeSuccess, ContractInvokeError>,
    expected: Error,
) -> ContractInvokeError {
    let error = result.expect_err("transaction must reject");
    assert_eq!(
        error.parse_return_value::<Error>().expect("parse rejection"),
        expected
    );
    error
}

#[test]
fn sealed_three_buyer_flow_allocates_two_units_and_conserves_every_microccd() {
    let (mut chain, address) = setup();
    let reserve = Amount::from_ccd(2);
    let before = [SELLER, A, B, C, PLATFORM].map(|account| balance(&chain, account));

    let started = start(&mut chain, address, reserve);
    let committed_a = commit(&mut chain, address, A, Amount::from_ccd(4), 1);
    let committed_b = commit(&mut chain, address, B, Amount::from_ccd(6), 2);
    let committed_c = commit(&mut chain, address, C, Amount::from_ccd(5), 3);
    assert_eq!(chain.contract_balance(address), Some(Amount::from_ccd(8)));

    chain
        .tick_block_time(Duration::from_millis(COMMIT_END))
        .expect("advance to shared reveal");
    // A buyer may reveal before the seller: both reveals share one time window.
    let revealed_a = reveal_bid(&mut chain, address, A, Amount::from_ccd(4), 1);
    assert_eq!(view(&chain, address).phase, Phase::Reveal);
    let seller_reveal = reveal_reserve(&mut chain, address, reserve);
    let revealed_b = reveal_bid(&mut chain, address, B, Amount::from_ccd(6), 2);
    let revealed_c = reveal_bid(&mut chain, address, C, Amount::from_ccd(5), 3);
    assert_eq!(chain.contract_balance(address), Some(Amount::from_ccd(17)));

    chain
        .tick_block_time(Duration::from_millis(REVEAL_END - COMMIT_END))
        .expect("advance to finalize");
    let finalized = update_empty(&mut chain, address, A, "finalize").expect("finalize");
    let state = view(&chain, address);
    assert_eq!(state.phase, Phase::Settled);
    assert_eq!(state.allocations.len(), 3);
    let winners: Vec<_> = state.allocations.iter().filter(|item| item.won).collect();
    assert_eq!(winners.len(), 2);
    assert_eq!(winners[0].bidder, B);
    assert_eq!(winners[0].price, Amount::from_ccd(4));
    assert_eq!(winners[0].buyer_fee, Amount::from_micro_ccd(200_000));
    assert_eq!(winners[1].bidder, C);
    assert_eq!(winners[1].price, Amount::from_micro_ccd(3_500_000));
    assert_eq!(winners[1].buyer_fee, Amount::from_micro_ccd(150_000));
    let loser = state.allocations.iter().find(|item| item.bidder == A).expect("loser allocation");
    assert!(!loser.won);
    assert_eq!(loser.buyer_refund, Amount::from_ccd(4));
    assert_eq!(chain.contract_balance(address), Some(Amount::zero()));

    assert_eq!(
        balance(&chain, A),
        before[1]
            - committed_a.transaction_fee
            - revealed_a.transaction_fee
            - finalized.transaction_fee
    );
    assert_eq!(
        balance(&chain, B),
        before[2] - Amount::from_micro_ccd(4_200_000)
            - committed_b.transaction_fee
            - revealed_b.transaction_fee
    );
    assert_eq!(
        balance(&chain, C),
        before[3] - Amount::from_micro_ccd(3_650_000)
            - committed_c.transaction_fee
            - revealed_c.transaction_fee
    );
    assert_eq!(
        balance(&chain, SELLER),
        before[0] + Amount::from_micro_ccd(7_150_000)
            - started.transaction_fee
            - seller_reveal.transaction_fee
    );
    assert_eq!(balance(&chain, PLATFORM), before[4] + Amount::from_micro_ccd(700_000));

    let settled_state = view(&chain, address);
    rejected(
        update_empty(&mut chain, address, B, "finalize"),
        Error::WrongPhase,
    );
    assert_eq!(view(&chain, address), settled_state);
    assert_eq!(chain.contract_balance(address), Some(Amount::zero()));
}

#[test]
fn wrong_phase_duplicate_and_wrong_reveal_are_rejected_before_state_changes() {
    let (mut chain, address) = setup();
    let reserve = Amount::from_ccd(2);
    start(&mut chain, address, reserve);
    commit(&mut chain, address, A, Amount::from_ccd(4), 1);
    let snapshot = view(&chain, address);

    rejected(
        update(
            &mut chain,
            address,
            SELLER,
            "commit_bid",
            &[7u8; 32],
            GUARANTEE,
        ),
        Error::SellerCannotBid,
    );
    rejected(
        update(
            &mut chain,
            address,
            A,
            "commit_bid",
            &[8u8; 32],
            GUARANTEE,
        ),
        Error::DuplicateBid,
    );
    rejected(
        update_empty(&mut chain, address, B, "finalize"),
        Error::WrongPhase,
    );
    assert_eq!(view(&chain, address), snapshot);

    chain
        .tick_block_time(Duration::from_millis(COMMIT_END))
        .expect("advance");
    rejected(
        update(
            &mut chain,
            address,
            SELLER,
            "reveal_reserve",
            &RevealParams {
                amount: reserve,
                salt: [8; 32],
            },
            Amount::zero(),
        ),
        Error::CommitmentMismatch,
    );
    assert_eq!(view(&chain, address), snapshot);
    reveal_reserve(&mut chain, address, reserve);
}

#[test]
fn seller_missing_reveal_refunds_buyers_and_distributes_seller_guarantee() {
    let (mut chain, address) = setup();
    start(&mut chain, address, Amount::from_ccd(2));
    let committed_a = commit(&mut chain, address, A, Amount::from_ccd(4), 1);
    let committed_b = commit(&mut chain, address, B, Amount::from_ccd(6), 2);
    let before_cancel = [A, B].map(|account| balance(&chain, account));
    chain
        .tick_block_time(Duration::from_millis(REVEAL_END))
        .expect("advance past shared reveal");
    let cancelled = update_empty(&mut chain, address, B, "cancel").expect("cancel round");

    assert_eq!(view(&chain, address).phase, Phase::Cancelled);
    assert_eq!(chain.contract_balance(address), Some(Amount::zero()));
    assert_eq!(
        balance(&chain, A),
        before_cancel[0] + Amount::from_ccd(3)
    );
    assert_eq!(
        balance(&chain, B),
        before_cancel[1] + Amount::from_ccd(3) - cancelled.transaction_fee
    );
    assert!(committed_a.transaction_fee > Amount::zero());
    assert!(committed_b.transaction_fee > Amount::zero());
}

#[test]
fn fee_threshold_and_rounding_follow_the_confirmed_rule() {
    let waived = winning_allocation(
        A,
        0,
        Amount::from_ccd(101),
        Amount::from_ccd(101),
        Amount::from_ccd(100),
    )
    .expect("waived allocation");
    assert_eq!(waived.buyer_fee, Amount::zero());

    let charged = winning_allocation(
        B,
        1,
        Amount::from_micro_ccd(6_000_019),
        Amount::from_micro_ccd(6_000_019),
        Amount::from_ccd(2),
    )
    .expect("charged allocation");
    assert_eq!(charged.price, Amount::from_micro_ccd(4_000_009));
    assert_eq!(charged.buyer_fee, Amount::from_micro_ccd(200_000));
    assert_eq!(charged.platform_receives, Amount::from_micro_ccd(400_000));
    let distributed = charged.buyer_refund.micro_ccd
        + charged.seller_receives.micro_ccd
        + charged.platform_receives.micro_ccd;
    assert_eq!(distributed, 6_000_019);
}

#[test]
fn empty_round_and_below_reserve_bid_close_without_trapped_funds() {
    let (mut empty_chain, empty_address) = setup();
    let seller_before = balance(&empty_chain, SELLER);
    let started = start(&mut empty_chain, empty_address, Amount::from_ccd(2));
    empty_chain
        .tick_block_time(Duration::from_millis(COMMIT_END))
        .expect("advance empty round");
    let cancelled = update_empty(&mut empty_chain, empty_address, B, "cancel")
        .expect("close empty round");
    assert_eq!(view(&empty_chain, empty_address).phase, Phase::NoSale);
    assert_eq!(empty_chain.contract_balance(empty_address), Some(Amount::zero()));
    assert_eq!(
        balance(&empty_chain, SELLER),
        seller_before - started.transaction_fee
    );
    assert!(cancelled.transaction_fee > Amount::zero());

    let (mut chain, address) = setup();
    start(&mut chain, address, Amount::from_ccd(2));
    commit(&mut chain, address, A, Amount::from_ccd(1), 3);
    chain
        .tick_block_time(Duration::from_millis(COMMIT_END))
        .expect("advance to shared reveal");
    reveal_reserve(&mut chain, address, Amount::from_ccd(2));
    reveal_bid(&mut chain, address, A, Amount::from_ccd(1), 3);
    chain
        .tick_block_time(Duration::from_millis(REVEAL_END - COMMIT_END))
        .expect("advance to finalize");
    update_empty(&mut chain, address, B, "finalize").expect("finalize no-sale round");
    assert_eq!(view(&chain, address).phase, Phase::NoSale);
    assert_eq!(chain.contract_balance(address), Some(Amount::zero()));
}

#[test]
fn equal_revealed_bids_use_earlier_commitment_sequence_at_the_capacity_cutoff() {
    let (mut chain, address) = setup();
    start(&mut chain, address, Amount::from_ccd(2));
    commit(&mut chain, address, A, Amount::from_ccd(6), 4);
    commit(&mut chain, address, B, Amount::from_ccd(6), 2);
    commit(&mut chain, address, C, Amount::from_ccd(6), 3);
    chain
        .tick_block_time(Duration::from_millis(COMMIT_END))
        .expect("advance to shared reveal");
    reveal_reserve(&mut chain, address, Amount::from_ccd(2));
    reveal_bid(&mut chain, address, A, Amount::from_ccd(6), 4);
    reveal_bid(&mut chain, address, B, Amount::from_ccd(6), 2);
    reveal_bid(&mut chain, address, C, Amount::from_ccd(6), 3);
    chain
        .tick_block_time(Duration::from_millis(REVEAL_END - COMMIT_END))
        .expect("advance to finalize");
    update_empty(&mut chain, address, SELLER, "finalize").expect("finalize tie");

    let state = view(&chain, address);
    let winners: Vec<_> = state.allocations.iter().filter(|allocation| allocation.won).collect();
    assert_eq!(winners.len(), 2);
    assert_eq!(winners[0].bidder, A);
    assert_eq!(winners[0].sequence, 0);
    assert_eq!(winners[1].bidder, B);
    assert_eq!(winners[1].sequence, 1);
    assert!(!state.allocations.iter().find(|allocation| allocation.bidder == C).expect("loser").won);
    assert_eq!(chain.contract_balance(address), Some(Amount::zero()));
}

#[test]
fn a_fourth_commitment_is_rejected_before_it_can_expand_bounded_settlement_work() {
    let (mut chain, address) = setup();
    start(&mut chain, address, Amount::from_ccd(2));
    commit(&mut chain, address, A, Amount::from_ccd(4), 1);
    commit(&mut chain, address, B, Amount::from_ccd(5), 2);
    commit(&mut chain, address, C, Amount::from_ccd(6), 3);
    rejected(
        update(&mut chain, address, D, "commit_bid", &[7u8; 32], GUARANTEE),
        Error::BidLimit,
    );
    assert_eq!(view(&chain, address).bids.len(), 3);
}
