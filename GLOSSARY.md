# Herald

Herald lets API Providers accept x402 payments on many chains with the stock x402 libraries. Payments land in addresses controlled by one NEAR account, and the Provider consolidates them later.

## Language

### Parties

**Provider**:
A developer or company that sells access to an API using x402 and Herald.
_Avoid_: Merchant, seller, developer

**Buyer**:
A person or agent that pays to call a Provider's API.
_Avoid_: Customer, client, payer

### Money

**Provider Account**:
The NEAR account that controls all of a Provider's Receiving Addresses.
_Avoid_: Herald account, wallet, master key

**Receiving Address**:
An ordinary address on one chain, derived from the Provider Account, that Buyers pay into.
_Avoid_: Derived address, deposit address, payTo, wallet

**Sweep**:
Moving funds out of the Receiving Addresses into one chain and asset the Provider chooses.
_Avoid_: Withdrawal, payout, cash out

### Pricing

**Payment Option**:
One chain and token combination a Buyer can pay with for a given request.
_Avoid_: Accept, payment method, rail

**Price**:
The USD amount the Provider sets for a request. It is the same for every Payment Option.
_Avoid_: Listed price, charged price
