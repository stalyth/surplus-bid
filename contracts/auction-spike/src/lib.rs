//! Bounded, public-bid auction spike. Testnet only.
use concordium_std::*;

pub const MAX_BIDS: u16 = 16;
pub const PER_SIDE_FEE_MICRO: u64 = 200_000;

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct InitParams {
    pub service_id: String,
    pub reserve: Amount,
    pub capacity: u16,
    pub max_bids: u16,
    pub deadline: Timestamp,
    pub fee_recipient: AccountAddress,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct Bid {
    pub bidder: AccountAddress,
    pub amount: Amount,
    pub sequence: u16,
}

#[derive(Debug, Serialize, SchemaType, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Open,
    Settled,
    NoSale,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct Allocation {
    pub sequence: u16,
    pub won: bool,
    pub price: Amount,
    pub buyer_refund: Amount,
    pub seller_receives: Amount,
    pub platform_receives: Amount,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct State {
    pub seller: AccountAddress,
    pub rules: InitParams,
    pub bids: Vec<Bid>,
    pub total_deposited: Amount,
    pub buyer_fee: Amount,
    pub seller_fee: Amount,
    pub phase: Phase,
    pub allocations: Vec<Allocation>,
}

#[derive(Debug, Serialize, SchemaType, Reject, PartialEq, Eq)]
pub enum Error {
    Parse,
    InvalidRules,
    BidTooLate,
    OnlyAccount,
    ZeroBid,
    BidLimit,
    DuplicateBid,
    InvalidFeeRecipient,
    Arithmetic,
    Closed,
    WrongDeposit,
    TooEarly,
    TransferFailed,
    BalanceMismatch,
}

#[init(contract = "auction_spike", parameter = "InitParams", error = "Error")]
fn init(ctx: &InitContext, _builder: &mut StateBuilder) -> Result<State, Error> {
    let rules: InitParams = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    ensure!(!rules.service_id.is_empty() && rules.service_id.len() <= 64
        && rules.reserve.micro_ccd >= PER_SIDE_FEE_MICRO
        && rules.capacity > 0 && rules.capacity <= rules.max_bids
        && rules.max_bids <= MAX_BIDS
        && rules.deadline > ctx.metadata().slot_time(), Error::InvalidRules);
    Ok(State { seller: ctx.init_origin(), rules, bids: Vec::new(), total_deposited: Amount::zero(),
        buyer_fee: Amount::from_micro_ccd(PER_SIDE_FEE_MICRO), seller_fee: Amount::from_micro_ccd(PER_SIDE_FEE_MICRO),
        phase: Phase::Open, allocations: Vec::new() })
}

#[receive(contract = "auction_spike", name = "bid", parameter = "Amount", payable, mutable, error = "Error")]
fn bid(ctx: &ReceiveContext, host: &mut Host<State>, amount: Amount) -> Result<(), Error> {
    let quote: Amount = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    let state = host.state();
    ensure_eq!(state.phase, Phase::Open, Error::Closed);
    ensure!(ctx.metadata().slot_time() < state.rules.deadline, Error::BidTooLate);
    ensure!(quote > Amount::zero(), Error::ZeroBid);
    let required = quote.micro_ccd.checked_add(PER_SIDE_FEE_MICRO).ok_or(Error::Arithmetic)?;
    ensure_eq!(amount.micro_ccd, required, Error::WrongDeposit);
    ensure!(state.bids.len() < usize::from(state.rules.max_bids), Error::BidLimit);
    let bidder = match ctx.sender() {
        Address::Account(account) => account,
        Address::Contract(_) => bail!(Error::OnlyAccount),
    };
    ensure!(!state.bids.iter().any(|bid| bid.bidder.is_alias(&bidder)), Error::DuplicateBid);
    // Fail before accepting funds if the fixed fee recipient cannot receive CCD.
    host.account_balance(state.rules.fee_recipient).map_err(|_| Error::InvalidFeeRecipient)?;
    let total = state.total_deposited.micro_ccd.checked_add(amount.micro_ccd).ok_or(Error::Arithmetic)?;
    let state = host.state_mut();
    let sequence = state.bids.len() as u16;
    state.bids.push(Bid { bidder, amount: quote, sequence });
    state.total_deposited = Amount::from_micro_ccd(total);
    Ok(())
}

/// Integer microCCD only. Round the midpoint down; the extra microCCD stays in the buyer refund.
pub fn allocation(bid: &Bid, reserve: Amount, won: bool) -> Result<Allocation, Error> {
    let locked = bid.amount.micro_ccd.checked_add(PER_SIDE_FEE_MICRO).ok_or(Error::Arithmetic)?;
    if !won {
        return Ok(Allocation { sequence: bid.sequence, won, price: Amount::zero(),
            buyer_refund: Amount::from_micro_ccd(locked), seller_receives: Amount::zero(),
            platform_receives: Amount::zero() });
    }
    ensure!(bid.amount >= reserve && reserve.micro_ccd >= PER_SIDE_FEE_MICRO, Error::InvalidRules);
    let price = reserve.micro_ccd + (bid.amount.micro_ccd - reserve.micro_ccd) / 2;
    Ok(Allocation { sequence: bid.sequence, won, price: Amount::from_micro_ccd(price),
        buyer_refund: Amount::from_micro_ccd(bid.amount.micro_ccd - price),
        seller_receives: Amount::from_micro_ccd(price - PER_SIDE_FEE_MICRO),
        platform_receives: Amount::from_micro_ccd(PER_SIDE_FEE_MICRO * 2) })
}

/// Descending bids, then ascending on-chain sequence. Below-reserve bids cannot win.
pub fn winner_indices(state: &State) -> Vec<usize> {
    let mut indices: Vec<usize> = state.bids.iter().enumerate()
        .filter(|(_,bid)| bid.amount >= state.rules.reserve).map(|(i,_)| i).collect();
    indices.sort_by(|&a,&b| state.bids[b].amount.cmp(&state.bids[a].amount)
        .then(state.bids[a].sequence.cmp(&state.bids[b].sequence)));
    indices.truncate(usize::from(state.rules.capacity));
    indices
}

fn transfer(host: &Host<State>, to: &AccountAddress, amount: Amount) -> Result<(), Error> {
    if amount > Amount::zero() {
        host.invoke_transfer(to, amount).map_err(|_| Error::TransferFailed)?;
    }
    Ok(())
}

#[receive(contract = "auction_spike", name = "finalize", mutable, error = "Error")]
fn finalize(ctx: &ReceiveContext, host: &mut Host<State>) -> Result<(), Error> {
    let state = host.state();
    ensure_eq!(state.phase, Phase::Open, Error::Closed);
    ensure!(ctx.metadata().slot_time() >= state.rules.deadline, Error::TooEarly);
    ensure_eq!(host.self_balance(), state.total_deposited, Error::BalanceMismatch);
    let winners = winner_indices(state);
    let allocations: Vec<Allocation> = state.bids.iter().enumerate()
        .map(|(i,bid)| allocation(bid, state.rules.reserve, winners.contains(&i)))
        .collect::<Result<_,_>>()?;
    let mut seller_total = 0u64;
    let mut platform_total = 0u64;
    let mut refund_total = 0u64;
    for item in &allocations {
        seller_total = seller_total.checked_add(item.seller_receives.micro_ccd).ok_or(Error::Arithmetic)?;
        platform_total = platform_total.checked_add(item.platform_receives.micro_ccd).ok_or(Error::Arithmetic)?;
        refund_total = refund_total.checked_add(item.buyer_refund.micro_ccd).ok_or(Error::Arithmetic)?;
    }
    let total = u128::from(seller_total) + u128::from(platform_total) + u128::from(refund_total);
    ensure_eq!(total, u128::from(state.total_deposited.micro_ccd), Error::BalanceMismatch);
    let seller = state.seller;
    let fee_recipient = state.rules.fee_recipient;
    let refunds: Vec<_> = state.bids.iter().zip(&allocations)
        .map(|(bid,item)| (bid.bidder,item.buyer_refund)).collect();
    // CCD transfers only target accounts. A failure atomically rolls back all payments and state.
    host.state_mut().phase = if winners.is_empty() { Phase::NoSale } else { Phase::Settled };
    host.state_mut().allocations = allocations;
    for (bidder,amount) in refunds { transfer(host,&bidder,amount)?; }
    transfer(host,&seller,Amount::from_micro_ccd(seller_total))?;
    transfer(host,&fee_recipient,Amount::from_micro_ccd(platform_total))?;
    ensure_eq!(host.self_balance(), Amount::zero(), Error::BalanceMismatch);
    Ok(())
}

#[receive(contract = "auction_spike", name = "view", return_value = "State")]
fn view<'a>(_ctx: &ReceiveContext, host: &'a Host<State>) -> ReceiveResult<&'a State> {
    Ok(host.state())
}
