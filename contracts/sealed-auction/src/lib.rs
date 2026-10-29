//! W2D2 single-round sealed-bid capacity allocation. Concordium Testnet only.
use concordium_std::*;

/// This MVP sells two identical capacity units in each window. Every buyer can
/// submit one one-unit order, so no partial-fill state is needed.
pub const CAPACITY_UNITS: u16 = 2;
/// Bounded storage and bounded settlement work. The third valid reveal is the
/// deterministic losing order when two higher eligible bids exist.
pub const MAX_BIDS: u16 = 3;
pub const ROUND_ID: u64 = 1;
const RESERVE_DOMAIN: &[u8] = b"SURPLUS_BID_RESERVE_V1";
const BID_DOMAIN: &[u8] = b"SURPLUS_BID_BID_V1";

pub type Commitment = [u8; 32];
pub type Salt = [u8; 32];

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct InitParams {
    pub service_id: String,
    pub guarantee: Amount,
    pub fee_recipient: AccountAddress,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct StartParams {
    pub reserve_commitment: Commitment,
    pub commit_end: Timestamp,
    pub reveal_end: Timestamp,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct RevealParams {
    pub amount: Amount,
    pub salt: Salt,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct BidCommitment {
    pub bidder: AccountAddress,
    pub commitment: Commitment,
    pub sequence: u16,
    pub revealed_bid: Option<Amount>,
    pub escrow: Amount,
}

#[derive(Debug, Serialize, SchemaType, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Commit,
    Reveal,
    Settled,
    NoSale,
    Cancelled,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct Allocation {
    pub bidder: AccountAddress,
    pub sequence: u16,
    pub won: bool,
    pub bid: Amount,
    pub price: Amount,
    pub buyer_fee: Amount,
    pub buyer_refund: Amount,
    pub seller_receives: Amount,
    pub platform_receives: Amount,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct State {
    pub seller: AccountAddress,
    pub config: InitParams,
    pub phase: Phase,
    pub round: Option<StartParams>,
    pub reserve: Option<Amount>,
    pub bids: Vec<BidCommitment>,
    pub total_deposited: Amount,
    pub allocations: Vec<Allocation>,
}

#[derive(Debug, Serialize, SchemaType, Reject, PartialEq, Eq)]
pub enum Error {
    Parse,
    InvalidRules,
    OnlyAccount,
    Unauthorized,
    WrongPhase,
    WrongTime,
    WrongDeposit,
    SellerCannotBid,
    BidLimit,
    DuplicateBid,
    MissingCommitment,
    AlreadyRevealed,
    CommitmentMismatch,
    InvalidFeeRecipient,
    Arithmetic,
    TransferFailed,
    BalanceMismatch,
    LogFull,
    LogMalformed,
}

impl From<LogError> for Error {
    fn from(value: LogError) -> Self {
        match value {
            LogError::Full => Self::LogFull,
            LogError::Malformed => Self::LogMalformed,
        }
    }
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct MarketInitializedEvent {
    pub seller: AccountAddress,
    pub service_id: String,
    pub guarantee: Amount,
    pub fee_recipient: AccountAddress,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct RoundStartedEvent {
    pub round_id: u64,
    pub reserve_commitment: Commitment,
    pub commit_end: Timestamp,
    pub reveal_end: Timestamp,
    pub capacity_units: u16,
    pub max_bids: u16,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct BidCommittedEvent {
    pub round_id: u64,
    pub bidder: AccountAddress,
    pub commitment: Commitment,
    pub sequence: u16,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct ReserveRevealedEvent {
    pub round_id: u64,
    pub reserve: Amount,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct BidRevealedEvent {
    pub round_id: u64,
    pub bidder: AccountAddress,
    pub bid: Amount,
    pub sequence: u16,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct WinnerSettledEvent {
    pub round_id: u64,
    pub bidder: AccountAddress,
    pub bid: Amount,
    pub price: Amount,
    pub buyer_fee: Amount,
    pub buyer_refund: Amount,
}

#[derive(Debug, Serialize, SchemaType, Clone, PartialEq, Eq)]
pub struct RoundClosedEvent {
    pub round_id: u64,
    pub phase: Phase,
    pub seller_total: Amount,
    pub platform_total: Amount,
}

#[derive(Debug, Serial, Deserial, SchemaType, PartialEq, Eq)]
#[concordium(repr(u8))]
pub enum Event {
    #[concordium(tag = 0)]
    MarketInitialized(MarketInitializedEvent),
    #[concordium(tag = 1)]
    RoundStarted(RoundStartedEvent),
    #[concordium(tag = 2)]
    BidCommitted(BidCommittedEvent),
    #[concordium(tag = 3)]
    ReserveRevealed(ReserveRevealedEvent),
    #[concordium(tag = 4)]
    BidRevealed(BidRevealedEvent),
    #[concordium(tag = 5)]
    WinnerSettled(WinnerSettledEvent),
    #[concordium(tag = 6)]
    RoundClosed(RoundClosedEvent),
}

pub fn make_commitment(
    crypto: &impl HasCryptoPrimitives,
    reserve: bool,
    contract: ContractAddress,
    account: AccountAddress,
    amount: Amount,
    salt: Salt,
) -> Commitment {
    let domain = if reserve { RESERVE_DOMAIN } else { BID_DOMAIN };
    let mut bytes = Vec::with_capacity(domain.len() + 8 + 8 + 8 + 32 + 8 + 32);
    bytes.extend_from_slice(domain);
    bytes.extend_from_slice(&contract.index.to_be_bytes());
    bytes.extend_from_slice(&contract.subindex.to_be_bytes());
    bytes.extend_from_slice(&ROUND_ID.to_be_bytes());
    bytes.extend_from_slice(&account.0);
    bytes.extend_from_slice(&amount.micro_ccd.to_be_bytes());
    bytes.extend_from_slice(&salt);
    crypto.hash_sha2_256(&bytes).0
}

#[init(
    contract = "surplus_bid",
    parameter = "InitParams",
    event = "Event",
    enable_logger,
    error = "Error"
)]
fn init(
    ctx: &InitContext,
    _builder: &mut StateBuilder,
    logger: &mut impl HasLogger,
) -> Result<State, Error> {
    let config: InitParams = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    ensure!(
        !config.service_id.is_empty()
            && config.service_id.len() <= 64
            && config.guarantee > Amount::zero(),
        Error::InvalidRules
    );
    let seller = ctx.init_origin();
    logger.log(&Event::MarketInitialized(MarketInitializedEvent {
        seller,
        service_id: config.service_id.clone(),
        guarantee: config.guarantee,
        fee_recipient: config.fee_recipient,
    }))?;
    Ok(State {
        seller,
        config,
        phase: Phase::Idle,
        round: None,
        reserve: None,
        bids: Vec::new(),
        total_deposited: Amount::zero(),
        allocations: Vec::new(),
    })
}

#[receive(
    contract = "surplus_bid",
    name = "start_round",
    parameter = "StartParams",
    payable,
    mutable,
    enable_logger,
    error = "Error"
)]
fn start_round(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    amount: Amount,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let params: StartParams = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    let state = host.state();
    ensure_eq!(state.phase, Phase::Idle, Error::WrongPhase);
    ensure_eq!(account_sender(ctx)?, state.seller, Error::Unauthorized);
    ensure_eq!(amount, state.config.guarantee, Error::WrongDeposit);
    let now = ctx.metadata().slot_time();
    ensure!(
        now < params.commit_end
            && params.commit_end < params.reveal_end,
        Error::InvalidRules
    );
    host.account_balance(state.config.fee_recipient)
        .map_err(|_| Error::InvalidFeeRecipient)?;
    logger.log(&Event::RoundStarted(RoundStartedEvent {
        round_id: ROUND_ID,
        reserve_commitment: params.reserve_commitment,
        commit_end: params.commit_end,
        reveal_end: params.reveal_end,
        capacity_units: CAPACITY_UNITS,
        max_bids: MAX_BIDS,
    }))?;
    let state = host.state_mut();
    state.phase = Phase::Commit;
    state.round = Some(params);
    state.total_deposited = amount;
    Ok(())
}

#[receive(
    contract = "surplus_bid",
    name = "commit_bid",
    parameter = "Commitment",
    payable,
    mutable,
    enable_logger,
    error = "Error"
)]
fn commit_bid(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    amount: Amount,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let commitment: Commitment = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    let bidder = account_sender(ctx)?;
    let state = host.state();
    let round = state.round.as_ref().ok_or(Error::WrongPhase)?;
    ensure_eq!(state.phase, Phase::Commit, Error::WrongPhase);
    ensure!(ctx.metadata().slot_time() < round.commit_end, Error::WrongTime);
    ensure_eq!(amount, state.config.guarantee, Error::WrongDeposit);
    ensure!(!state.seller.is_alias(&bidder), Error::SellerCannotBid);
    ensure!(state.bids.len() < usize::from(MAX_BIDS), Error::BidLimit);
    ensure!(
        !state.bids.iter().any(|item| item.bidder.is_alias(&bidder)),
        Error::DuplicateBid
    );
    let total = state
        .total_deposited
        .micro_ccd
        .checked_add(amount.micro_ccd)
        .ok_or(Error::Arithmetic)?;
    let sequence = state.bids.len() as u16;
    logger.log(&Event::BidCommitted(BidCommittedEvent {
        round_id: ROUND_ID,
        bidder,
        commitment,
        sequence,
    }))?;
    let state = host.state_mut();
    state.bids.push(BidCommitment {
        bidder,
        commitment,
        sequence,
        revealed_bid: None,
        escrow: amount,
    });
    state.total_deposited = Amount::from_micro_ccd(total);
    Ok(())
}

#[receive(
    contract = "surplus_bid",
    name = "reveal_reserve",
    parameter = "RevealParams",
    mutable,
    enable_logger,
    error = "Error"
)]
fn reveal_reserve(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let reveal: RevealParams = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    let state = host.state();
    let round = state.round.as_ref().ok_or(Error::WrongPhase)?;
    ensure!(matches!(state.phase, Phase::Commit | Phase::Reveal), Error::WrongPhase);
    ensure_eq!(account_sender(ctx)?, state.seller, Error::Unauthorized);
    let now = ctx.metadata().slot_time();
    ensure!(now >= round.commit_end && now < round.reveal_end, Error::WrongTime);
    let actual = make_commitment(
        &ExternCryptoPrimitives,
        true,
        ctx.self_address(),
        state.seller,
        reveal.amount,
        reveal.salt,
    );
    ensure_eq!(actual, round.reserve_commitment, Error::CommitmentMismatch);
    logger.log(&Event::ReserveRevealed(ReserveRevealedEvent {
        round_id: ROUND_ID,
        reserve: reveal.amount,
    }))?;
    let state = host.state_mut();
    state.reserve = Some(reveal.amount);
    state.phase = Phase::Reveal;
    Ok(())
}

#[receive(
    contract = "surplus_bid",
    name = "reveal_bid",
    parameter = "RevealParams",
    payable,
    mutable,
    enable_logger,
    error = "Error"
)]
fn reveal_bid(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    amount: Amount,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let reveal: RevealParams = ctx.parameter_cursor().get().map_err(|_| Error::Parse)?;
    let bidder = account_sender(ctx)?;
    let state = host.state();
    let round = state.round.as_ref().ok_or(Error::WrongPhase)?;
    ensure!(matches!(state.phase, Phase::Commit | Phase::Reveal), Error::WrongPhase);
    let now = ctx.metadata().slot_time();
    ensure!(
        now >= round.commit_end && now < round.reveal_end,
        Error::WrongTime
    );
    let index = state
        .bids
        .iter()
        .position(|item| item.bidder.is_alias(&bidder))
        .ok_or(Error::MissingCommitment)?;
    let item = &state.bids[index];
    ensure!(item.revealed_bid.is_none(), Error::AlreadyRevealed);
    let actual = make_commitment(
        &ExternCryptoPrimitives,
        false,
        ctx.self_address(),
        item.bidder,
        reveal.amount,
        reveal.salt,
    );
    ensure_eq!(actual, item.commitment, Error::CommitmentMismatch);
    let required_top_up = reveal
        .amount
        .micro_ccd
        .saturating_sub(state.config.guarantee.micro_ccd);
    ensure_eq!(amount.micro_ccd, required_top_up, Error::WrongDeposit);
    let escrow = item
        .escrow
        .micro_ccd
        .checked_add(amount.micro_ccd)
        .ok_or(Error::Arithmetic)?;
    let total = state
        .total_deposited
        .micro_ccd
        .checked_add(amount.micro_ccd)
        .ok_or(Error::Arithmetic)?;
    let sequence = item.sequence;
    logger.log(&Event::BidRevealed(BidRevealedEvent {
        round_id: ROUND_ID,
        bidder: item.bidder,
        bid: reveal.amount,
        sequence,
    }))?;
    let state = host.state_mut();
    let item = &mut state.bids[index];
    item.revealed_bid = Some(reveal.amount);
    item.escrow = Amount::from_micro_ccd(escrow);
    state.total_deposited = Amount::from_micro_ccd(total);
    state.phase = Phase::Reveal;
    Ok(())
}

pub fn winning_allocation(
    bidder: AccountAddress,
    sequence: u16,
    bid: Amount,
    escrow: Amount,
    reserve: Amount,
) -> Result<Allocation, Error> {
    ensure!(bid >= reserve, Error::InvalidRules);
    let surplus = bid.micro_ccd - reserve.micro_ccd;
    let price = reserve
        .micro_ccd
        .checked_add(surplus / 2)
        .ok_or(Error::Arithmetic)?;
    let fee_applies = u128::from(surplus) * 10 >= u128::from(price);
    let buyer_fee = if fee_applies { surplus / 20 } else { 0 };
    let buyer_spend = price.checked_add(buyer_fee).ok_or(Error::Arithmetic)?;
    ensure!(buyer_spend <= bid.micro_ccd && buyer_spend <= escrow.micro_ccd, Error::Arithmetic);
    let seller_receives = price.checked_sub(buyer_fee).ok_or(Error::Arithmetic)?;
    let platform_receives = buyer_fee.checked_mul(2).ok_or(Error::Arithmetic)?;
    Ok(Allocation {
        bidder,
        sequence,
        won: true,
        bid,
        price: Amount::from_micro_ccd(price),
        buyer_fee: Amount::from_micro_ccd(buyer_fee),
        buyer_refund: Amount::from_micro_ccd(escrow.micro_ccd - buyer_spend),
        seller_receives: Amount::from_micro_ccd(seller_receives),
        platform_receives: Amount::from_micro_ccd(platform_receives),
    })
}

#[receive(
    contract = "surplus_bid",
    name = "finalize",
    mutable,
    enable_logger,
    error = "Error"
)]
fn finalize(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let state = host.state();
    let round = state.round.as_ref().ok_or(Error::WrongPhase)?;
    ensure_eq!(state.phase, Phase::Reveal, Error::WrongPhase);
    ensure!(ctx.metadata().slot_time() >= round.reveal_end, Error::WrongTime);
    ensure_eq!(host.self_balance(), state.total_deposited, Error::BalanceMismatch);
    let reserve = state.reserve.ok_or(Error::WrongPhase)?;

    // This is a two-unit batch allocation, not a single-item auction. Each
    // eligible bid represents one identical capacity unit. Rank by disclosed
    // unit bid, then use the immutable commit sequence to break ties.
    let mut ranked: Vec<(usize, Amount, u16)> = state
        .bids
        .iter()
        .enumerate()
        .filter_map(|(index, item)| item.revealed_bid.map(|bid| (index, bid, item.sequence)))
        .filter(|(_, bid, _)| *bid >= reserve)
        .collect();
    ranked.sort_by(|left, right| {
        right.1.cmp(&left.1).then_with(|| left.2.cmp(&right.2))
    });
    ranked.truncate(usize::from(CAPACITY_UNITS));
    let winners: Vec<usize> = ranked.into_iter().map(|(index, _, _)| index).collect();

    let mut allocations = Vec::new();
    let mut refunds = Vec::new();
    let mut seller_total = state.config.guarantee.micro_ccd;
    let mut platform_total = 0u64;
    let mut refund_total = 0u64;
    for (index, item) in state.bids.iter().enumerate() {
        match item.revealed_bid {
            None => {
                seller_total = seller_total
                    .checked_add(item.escrow.micro_ccd)
                    .ok_or(Error::Arithmetic)?;
            }
            Some(bid) if winners.contains(&index) => {
                let allocation = winning_allocation(
                    item.bidder,
                    item.sequence,
                    bid,
                    item.escrow,
                    reserve,
                )?;
                seller_total = seller_total
                    .checked_add(allocation.seller_receives.micro_ccd)
                    .ok_or(Error::Arithmetic)?;
                platform_total = platform_total
                    .checked_add(allocation.platform_receives.micro_ccd)
                    .ok_or(Error::Arithmetic)?;
                refund_total = refund_total
                    .checked_add(allocation.buyer_refund.micro_ccd)
                    .ok_or(Error::Arithmetic)?;
                refunds.push((item.bidder, allocation.buyer_refund));
                allocations.push(allocation);
            }
            Some(bid) => {
                refund_total = refund_total
                    .checked_add(item.escrow.micro_ccd)
                    .ok_or(Error::Arithmetic)?;
                refunds.push((item.bidder, item.escrow));
                allocations.push(Allocation {
                    bidder: item.bidder,
                    sequence: item.sequence,
                    won: false,
                    bid,
                    price: Amount::zero(),
                    buyer_fee: Amount::zero(),
                    buyer_refund: item.escrow,
                    seller_receives: Amount::zero(),
                    platform_receives: Amount::zero(),
                });
            }
        }
    }
    let distributed = u128::from(seller_total)
        + u128::from(platform_total)
        + u128::from(refund_total);
    ensure_eq!(distributed, u128::from(state.total_deposited.micro_ccd), Error::BalanceMismatch);

    let seller = state.seller;
    let fee_recipient = state.config.fee_recipient;
    let phase = if winners.is_empty() { Phase::NoSale } else { Phase::Settled };
    host.state_mut().phase = phase;
    host.state_mut().allocations = allocations.clone();
    for (bidder, refund) in refunds {
        transfer(host, &bidder, refund)?;
    }
    transfer(host, &seller, Amount::from_micro_ccd(seller_total))?;
    transfer(host, &fee_recipient, Amount::from_micro_ccd(platform_total))?;
    ensure_eq!(host.self_balance(), Amount::zero(), Error::BalanceMismatch);

    for winner_allocation in allocations.iter().filter(|item| item.won) {
        logger.log(&Event::WinnerSettled(WinnerSettledEvent {
            round_id: ROUND_ID,
            bidder: winner_allocation.bidder,
            bid: winner_allocation.bid,
            price: winner_allocation.price,
            buyer_fee: winner_allocation.buyer_fee,
            buyer_refund: winner_allocation.buyer_refund,
        }))?;
    }
    logger.log(&Event::RoundClosed(RoundClosedEvent {
        round_id: ROUND_ID,
        phase,
        seller_total: Amount::from_micro_ccd(seller_total),
        platform_total: Amount::from_micro_ccd(platform_total),
    }))?;
    Ok(())
}

#[receive(
    contract = "surplus_bid",
    name = "cancel",
    mutable,
    enable_logger,
    error = "Error"
)]
fn cancel(
    ctx: &ReceiveContext,
    host: &mut Host<State>,
    logger: &mut impl HasLogger,
) -> Result<(), Error> {
    let state = host.state();
    let round = state.round.as_ref().ok_or(Error::WrongPhase)?;
    ensure!(matches!(state.phase, Phase::Commit | Phase::Reveal), Error::WrongPhase);
    let now = ctx.metadata().slot_time();
    let empty = state.bids.is_empty() && now >= round.commit_end;
    let seller_missed = !state.bids.is_empty() && state.reserve.is_none() && now >= round.reveal_end;
    ensure!(empty || seller_missed, Error::WrongTime);
    ensure_eq!(host.self_balance(), state.total_deposited, Error::BalanceMismatch);

    let seller = state.seller;
    let guarantee_amount = state.config.guarantee;
    let guarantee = guarantee_amount.micro_ccd;
    let bidders: Vec<_> = state.bids.iter().map(|item| (item.bidder, item.escrow)).collect();
    if empty {
        host.state_mut().phase = Phase::NoSale;
        transfer(host, &seller, guarantee_amount)?;
    } else {
        let count = bidders.len() as u64;
        let base = guarantee / count;
        let remainder = guarantee % count;
        host.state_mut().phase = Phase::Cancelled;
        for (index, (bidder, escrow)) in bidders.iter().enumerate() {
            let bonus = base + u64::from((index as u64) < remainder);
            let refund = escrow.micro_ccd.checked_add(bonus).ok_or(Error::Arithmetic)?;
            transfer(host, bidder, Amount::from_micro_ccd(refund))?;
        }
    }
    ensure_eq!(host.self_balance(), Amount::zero(), Error::BalanceMismatch);
    logger.log(&Event::RoundClosed(RoundClosedEvent {
        round_id: ROUND_ID,
        phase: host.state().phase,
        seller_total: Amount::zero(),
        platform_total: Amount::zero(),
    }))?;
    Ok(())
}

fn account_sender(ctx: &ReceiveContext) -> Result<AccountAddress, Error> {
    match ctx.sender() {
        Address::Account(account) => Ok(account),
        Address::Contract(_) => Err(Error::OnlyAccount),
    }
}

fn transfer(host: &Host<State>, to: &AccountAddress, amount: Amount) -> Result<(), Error> {
    if amount > Amount::zero() {
        host.invoke_transfer(to, amount).map_err(|_| Error::TransferFailed)?;
    }
    Ok(())
}

#[receive(contract = "surplus_bid", name = "view", return_value = "State")]
fn view<'a>(_ctx: &ReceiveContext, host: &'a Host<State>) -> ReceiveResult<&'a State> {
    Ok(host.state())
}
