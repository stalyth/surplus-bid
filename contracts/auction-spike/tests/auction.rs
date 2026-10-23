use auction_spike::{allocation, Allocation, Bid, Error, InitParams, Phase, State, MAX_BIDS, PER_SIDE_FEE_MICRO};
use concordium_smart_contract_testing::*;

// Local test accounts and balances only. They are not Testnet transaction evidence.
const SELLER: AccountAddress = AccountAddress([0;32]);
const A: AccountAddress = AccountAddress([1;32]);
const B: AccountAddress = AccountAddress([2;32]);
const C: AccountAddress = AccountAddress([3;32]);
const PLATFORM: AccountAddress = AccountAddress([30;32]);

fn rules() -> InitParams {
    InitParams { service_id:"demo-service".into(), reserve:Amount::from_ccd(2),
        capacity:1, max_bids:MAX_BIDS, deadline:Timestamp::from_timestamp_millis(1000), fee_recipient:PLATFORM }
}
fn setup(params: InitParams) -> Result<(Chain,ContractAddress),ContractInitError> {
    let mut chain = Chain::new();
    chain.create_account(Account::new(SELLER,Amount::from_ccd(10000)));
    chain.create_account(Account::new(PLATFORM,Amount::zero()));
    for i in 1..=18 { chain.create_account(Account::new(AccountAddress([i;32]),Amount::from_ccd(10000))); }
    let deployed = chain.module_deploy_v1(Signer::with_one_key(),SELLER,module_load_v1("module.wasm.v1").unwrap()).unwrap();
    let instance = chain.contract_init(Signer::with_one_key(),SELLER,Energy::from(100000),InitContractPayload {
        mod_ref:deployed.module_reference,init_name:OwnedContractName::new_unchecked("init_auction_spike".into()),
        param:OwnedParameter::from_serial(&params).unwrap(),amount:Amount::zero(),
    })?;
    Ok((chain,instance.contract_address))
}
fn payload(address:ContractAddress,entry:&str,quote:Option<Amount>,amount:Amount)->UpdateContractPayload {
    UpdateContractPayload {address,receive_name:OwnedReceiveName::new_unchecked(format!("auction_spike.{entry}")),
        message:quote.map(|q|OwnedParameter::from_serial(&q).unwrap()).unwrap_or(OwnedParameter::empty()),amount}
}
fn call(chain:&mut Chain,address:ContractAddress,who:AccountAddress,entry:&str,quote:Option<Amount>,amount:Amount)
    ->Result<ContractInvokeSuccess,ContractInvokeError> {
    chain.contract_update(Signer::with_one_key(),who,Address::Account(who),Energy::from(100000),payload(address,entry,quote,amount))
}
fn bid(chain:&mut Chain,address:ContractAddress,who:AccountAddress,quote:Amount)->ContractInvokeSuccess {
    call(chain,address,who,"bid",Some(quote),Amount::from_micro_ccd(quote.micro_ccd+PER_SIDE_FEE_MICRO)).unwrap()
}
fn view(chain:&Chain,address:ContractAddress)->State {
    let result=chain.contract_invoke(SELLER,Address::Account(SELLER),Energy::from(100000),payload(address,"view",None,Amount::zero())).unwrap();
    result.parse_return_value().unwrap()
}
fn finish(chain:&mut Chain,address:ContractAddress)->ContractInvokeSuccess {
    if chain.block_time().timestamp_millis()<1000 { chain.tick_block_time(Duration::from_millis(1000-chain.block_time().timestamp_millis())).unwrap(); }
    call(chain,address,SELLER,"finalize",None,Amount::zero()).unwrap()
}
fn rejected(result:Result<ContractInvokeSuccess,ContractInvokeError>,expected:Error)->ContractInvokeError {
    let error=result.unwrap_err();
    assert_eq!(error.parse_return_value::<Error>().unwrap(),expected);
    assert!(error.reject_code().unwrap()<0);error
}
fn balance(chain:&Chain,account:AccountAddress)->Amount { chain.account_balance_available(account).unwrap() }
fn assert_conservation(state:&State) {
    let sum:u128=state.allocations.iter().map(|a|u128::from(a.buyer_refund.micro_ccd)+u128::from(a.seller_receives.micro_ccd)+u128::from(a.platform_receives.micro_ccd)).sum();
    assert_eq!(sum,u128::from(state.total_deposited.micro_ccd));
}

#[test]
fn two_buyers_one_winner_fixed_fees_and_all_balances_reconcile() {
    let(mut chain,address)=setup(rules()).unwrap();
    let before=[SELLER,A,B,PLATFORM].map(|who|balance(&chain,who));
    let a=bid(&mut chain,address,A,Amount::from_ccd(4));
    let b=bid(&mut chain,address,B,Amount::from_ccd(6));
    assert_eq!(chain.contract_balance(address),Some(Amount::from_micro_ccd(10_400_000)));
    let finalized=finish(&mut chain,address);
    let state=view(&chain,address);
    assert_eq!(state.phase,Phase::Settled);
    assert_eq!(state.allocations[0],Allocation {sequence:0,won:false,price:Amount::zero(),buyer_refund:Amount::from_micro_ccd(4_200_000),seller_receives:Amount::zero(),platform_receives:Amount::zero()});
    assert_eq!(state.allocations[1],Allocation {sequence:1,won:true,price:Amount::from_ccd(4),buyer_refund:Amount::from_ccd(2),seller_receives:Amount::from_micro_ccd(3_800_000),platform_receives:Amount::from_micro_ccd(400_000)});
    assert_eq!(balance(&chain,A),before[1]-a.transaction_fee);
    assert_eq!(balance(&chain,B),before[2]-Amount::from_micro_ccd(4_200_000)-b.transaction_fee);
    assert_eq!(balance(&chain,SELLER),before[0]+Amount::from_micro_ccd(3_800_000)-finalized.transaction_fee);
    assert_eq!(balance(&chain,PLATFORM),before[3]+Amount::from_micro_ccd(400_000));
    assert_eq!(chain.contract_balance(address),Some(Amount::zero()));assert_conservation(&state);
}

#[test]
fn equal_bids_use_first_chain_sequence_and_rules_stay_fixed() {
    let params=rules();let(mut chain,address)=setup(params.clone()).unwrap();
    bid(&mut chain,address,B,Amount::from_ccd(4));bid(&mut chain,address,A,Amount::from_ccd(4));finish(&mut chain,address);
    let state=view(&chain,address);assert_eq!(state.rules,params);
    assert!(state.allocations[0].won);assert!(!state.allocations[1].won);
    assert_eq!(state.bids[0].bidder,B);assert_eq!(state.allocations[0].price,Amount::from_ccd(3));assert_conservation(&state);
}

#[test]
fn capacity_limits_winners_and_applies_fees_per_filled_order() {
    let mut params=rules();params.capacity=2;
    let(mut chain,address)=setup(params).unwrap();
    bid(&mut chain,address,A,Amount::from_ccd(4));bid(&mut chain,address,B,Amount::from_ccd(6));bid(&mut chain,address,C,Amount::from_ccd(8));
    finish(&mut chain,address);let state=view(&chain,address);
    assert_eq!(state.allocations.iter().filter(|a|a.won).count(),2);
    assert!(!state.allocations[0].won);assert!(state.allocations[1].won&&state.allocations[2].won);
    assert_eq!(balance(&chain,PLATFORM),Amount::from_micro_ccd(800_000));assert_conservation(&state);
}

#[test]
fn zero_bids_and_all_below_reserve_end_without_platform_fees() {
    for low_bid in [false,true] {
        let(mut chain,address)=setup(rules()).unwrap();let before=balance(&chain,A);
        let fee=if low_bid {bid(&mut chain,address,A,Amount::from_ccd(1)).transaction_fee}else{Amount::zero()};
        finish(&mut chain,address);let state=view(&chain,address);
        assert_eq!(state.phase,Phase::NoSale);assert_eq!(balance(&chain,PLATFORM),Amount::zero());
        assert_eq!(balance(&chain,A),before-fee);assert_eq!(chain.contract_balance(address),Some(Amount::zero()));assert_conservation(&state);
    }
}

#[test]
fn reserve_equality_and_capacity_above_bid_count_work() {
    let mut params=rules();params.capacity=3;let(mut chain,address)=setup(params).unwrap();
    bid(&mut chain,address,A,Amount::from_ccd(2));finish(&mut chain,address);
    let state=view(&chain,address);assert_eq!(state.allocations.len(),1);assert!(state.allocations[0].won);
    assert_eq!(state.allocations[0].price,Amount::from_ccd(2));assert_eq!(state.allocations[0].buyer_refund,Amount::zero());assert_conservation(&state);
}

#[test]
fn deadline_boundary_and_repeated_settlement_cannot_pay_twice() {
    let(mut chain,address)=setup(rules()).unwrap();
    bid(&mut chain,address,A,Amount::from_ccd(4));
    rejected(call(&mut chain,address,SELLER,"finalize",None,Amount::zero()),Error::TooEarly);
    chain.tick_block_time(Duration::from_millis(1000)).unwrap();
    rejected(call(&mut chain,address,B,"bid",Some(Amount::from_ccd(6)),Amount::from_micro_ccd(6_200_000)),Error::BidTooLate);
    call(&mut chain,address,B,"finalize",None,Amount::zero()).unwrap(); // Permissionless settlement.
    let state=view(&chain,address);let balances=[SELLER,A,PLATFORM].map(|who|balance(&chain,who));
    rejected(call(&mut chain,address,C,"finalize",None,Amount::zero()),Error::Closed);
    assert_eq!([SELLER,A,PLATFORM].map(|who|balance(&chain,who)),balances);
    assert_eq!(view(&chain,address),state);assert_eq!(chain.contract_balance(address),Some(Amount::zero()));
    rejected(call(&mut chain,address,B,"bid",Some(Amount::from_ccd(6)),Amount::from_micro_ccd(6_200_000)),Error::Closed);
}

#[test]
fn invalid_bid_amounts_duplicate_account_and_limit_do_not_lock_extra_funds() {
    let mut params=rules();params.max_bids=1;let(mut chain,address)=setup(params).unwrap();
    rejected(call(&mut chain,address,A,"bid",Some(Amount::zero()),Amount::from_micro_ccd(200_000)),Error::ZeroBid);
    for amount in [Amount::from_ccd(4),Amount::from_micro_ccd(4_199_999),Amount::from_micro_ccd(4_200_001)] {
        let before=balance(&chain,A);let error=rejected(call(&mut chain,address,A,"bid",Some(Amount::from_ccd(4)),amount),Error::WrongDeposit);
        assert_eq!(balance(&chain,A),before-error.transaction_fee);assert_eq!(chain.contract_balance(address),Some(Amount::zero()));
    }
    bid(&mut chain,address,A,Amount::from_ccd(4));
    rejected(call(&mut chain,address,B,"bid",Some(Amount::from_ccd(6)),Amount::from_micro_ccd(6_200_000)),Error::BidLimit);
    assert_eq!(view(&chain,address).bids.len(),1);assert_eq!(chain.contract_balance(address),Some(Amount::from_micro_ccd(4_200_000)));
    let(mut chain,address)=setup(rules()).unwrap();bid(&mut chain,address,A,Amount::from_ccd(4));
    rejected(call(&mut chain,address,A,"bid",Some(Amount::from_ccd(6)),Amount::from_micro_ccd(6_200_000)),Error::DuplicateBid);
    let mut alias=A;alias.0[31]=99;
    let result=chain.contract_update(Signer::with_one_key(),A,Address::Account(alias),Energy::from(100000),payload(address,"bid",Some(Amount::from_ccd(6)),Amount::from_micro_ccd(6_200_000)));
    rejected(result,Error::DuplicateBid);assert_eq!(view(&chain,address).bids.len(),1);
}

#[test]
fn missing_fee_recipient_is_rejected_before_any_deposit_is_kept() {
    let mut params=rules();params.fee_recipient=AccountAddress([99;32]);let(mut chain,address)=setup(params).unwrap();
    rejected(call(&mut chain,address,A,"bid",Some(Amount::from_ccd(4)),Amount::from_micro_ccd(4_200_000)),Error::InvalidFeeRecipient);
    assert_eq!(chain.contract_balance(address),Some(Amount::zero()));assert!(view(&chain,address).bids.is_empty());
}

#[test]
fn invalid_initial_rules_are_rejected_by_the_contract() {
    let mut invalid=Vec::new();
    let mut p=rules();p.capacity=0;invalid.push(p);
    let mut p=rules();p.capacity=2;p.max_bids=1;invalid.push(p);
    let mut p=rules();p.max_bids=MAX_BIDS+1;invalid.push(p);
    let mut p=rules();p.deadline=Timestamp::from_timestamp_millis(0);invalid.push(p);
    let mut p=rules();p.reserve=Amount::from_micro_ccd(PER_SIDE_FEE_MICRO-1);invalid.push(p);
    let mut p=rules();p.service_id=String::new();invalid.push(p);
    let mut p=rules();p.service_id="x".repeat(65);invalid.push(p);
    for params in invalid {
        let error=setup(params).err().expect("must reject invalid rules");
        match error.kind {
            ContractInitErrorKind::ExecutionError{error:InitExecutionError::Reject{reason,..},..}=>{
                // Init rejects expose the reject code, unlike receive rejects with serialized errors.
                assert_eq!(reason,-2); // InvalidRules, a published contract reject code.
            }, other=>panic!("unexpected failure: {other:?}"),
        }
    }
}

#[test]
fn midpoint_rounding_and_u64_boundaries_preserve_every_microccd() {
    let reserve=Amount::from_micro_ccd(PER_SIDE_FEE_MICRO);
    for quote in [PER_SIDE_FEE_MICRO,PER_SIDE_FEE_MICRO+1,PER_SIDE_FEE_MICRO+2,u64::MAX-PER_SIDE_FEE_MICRO] {
        let bid=Bid{bidder:A,amount:Amount::from_micro_ccd(quote),sequence:0};
        for won in [true,false] {
            let a=allocation(&bid,reserve,won).unwrap();
            let sum=u128::from(a.buyer_refund.micro_ccd)+u128::from(a.seller_receives.micro_ccd)+u128::from(a.platform_receives.micro_ccd);
            assert_eq!(sum,u128::from(quote)+u128::from(PER_SIDE_FEE_MICRO));
            if won {assert_eq!(a.price.micro_ccd,PER_SIDE_FEE_MICRO+(quote-PER_SIDE_FEE_MICRO)/2);}
        }
    }
    let too_large=Bid{bidder:A,amount:Amount::from_micro_ccd(u64::MAX),sequence:0};
    assert_eq!(allocation(&too_large,reserve,true),Err(Error::Arithmetic));
}

#[test]
fn max_bid_count_settles_and_running_out_of_energy_rolls_back_payments() {
    let(mut chain,address)=setup(rules()).unwrap();
    for i in 1..=MAX_BIDS as u8 {bid(&mut chain,address,AccountAddress([i;32]),Amount::from_ccd(u64::from(i)+2));}
    let measured=finish(&mut chain,address);assert_eq!(view(&chain,address).allocations.iter().filter(|a|a.won).count(),1);
    assert!(measured.storage_energy.energy>0);
    for during_execution in [true,false] {
        let(mut chain,address)=setup(rules()).unwrap();
        for i in 1..=MAX_BIDS as u8 {bid(&mut chain,address,AccountAddress([i;32]),Amount::from_ccd(u64::from(i)+2));}
        chain.tick_block_time(Duration::from_millis(1000)).unwrap();
        let state=view(&chain,address);let contract_balance=chain.contract_balance(address);
        let seller_before=balance(&chain,SELLER);
        let recipients:Vec<_>=(1..=MAX_BIDS as u8).map(|i|AccountAddress([i;32])).chain([PLATFORM]).collect();
        let before:Vec<_>=recipients.iter().map(|who|balance(&chain,*who)).collect();
        let budget=measured.energy_used.energy-1-if during_execution {measured.storage_energy.energy}else{0};
        let error=chain.contract_update(Signer::with_one_key(),SELLER,Address::Account(SELLER),Energy::from(budget),payload(address,"finalize",None,Amount::zero())).unwrap_err();
        assert!(matches!(error.kind,ContractInvokeErrorKind::OutOfEnergy{..}));
        if during_execution {
            assert_eq!(balance(&chain,SELLER),seller_before-error.transaction_fee);
        } else {
            // Testing library 4.4.0 returns before charging fees on storage exhaustion
            // (impls.rs, contract_update -> changeset.persist error branch). Check no
            // seller payout survives, but do not treat this simulated fee as chain evidence.
            assert!(balance(&chain,SELLER)<=seller_before);
        }
        assert_eq!(view(&chain,address),state);assert_eq!(chain.contract_balance(address),contract_balance);
        assert_eq!(recipients.iter().map(|who|balance(&chain,*who)).collect::<Vec<_>>(),before);
        finish(&mut chain,address);assert_eq!(chain.contract_balance(address),Some(Amount::zero()));assert_conservation(&view(&chain,address));
    }
}
