## ADDED Requirements

### Requirement: A product declares the unit it is sold in

The system SHALL let a product declare a base unit from a fixed catalogue, and SHALL treat the declaration as optional, where an absent value means the default counted unit. The product's price and stock SHALL both be understood as being *per* that base unit.

The catalogue SHALL cover the two kinds of unit a store actually uses:

- **Counted units** — the default unit plus packaging forms: bottle, crate, can, jar, bag, pack, keg, pallet.
- **Measured units** — litre, millilitre, kilogram, gram.

#### Scenario: An existing product keeps behaving as counted units

- **WHEN** a product created before this capability is read or sold
- **THEN** it behaves as a counted product in every screen, with no migration and no visible change

#### Scenario: A packaging unit changes the label, not the arithmetic

- **WHEN** a product's unit is set to a packaging form such as bottle or crate
- **THEN** its quantity behaves exactly as a counted product's does, and only its displayed unit changes

### Requirement: Only measured units accept fractional quantities

The system SHALL allow fractional quantities for a product whose unit is a measured one, and SHALL restrict entry to whole numbers for every counted unit, including all packaging forms. The rule SHALL be derived from the product's unit rather than configured separately, so the two can never disagree.

#### Scenario: A product measured in kilograms accepts a fraction

- **WHEN** a cashier enters 1.5 for a product whose unit is kilograms
- **THEN** the quantity is accepted and the line total is computed from it

#### Scenario: A product sold by the bottle refuses a fraction

- **WHEN** a cashier attempts to enter a fractional quantity for a product whose unit is bottle
- **THEN** the entry is not accepted as a fraction, exactly as for the default counted unit

#### Scenario: One cart holds both kinds

- **WHEN** a cart contains a product sold by the crate and a product sold by the kilogram
- **THEN** each line enforces its own product's rule independently

### Requirement: Unit-aware quantity applies wherever a quantity is entered

The system SHALL apply the same per-product rule in every quantity entry point: the sale's quantity stepper and cart line, and the supplier purchase form. A quantity accepted in one of them SHALL be accepted in the others for the same product.

#### Scenario: A purchase receives a fractional quantity

- **WHEN** a purchase from a supplier records 12.5 kilograms of a product measured in kilograms
- **THEN** the quantity is accepted and stock rises by that amount

### Requirement: The unit is displayed wherever a quantity is displayed

The system SHALL show a product's unit alongside its quantity wherever that quantity is presented, so "2" is never ambiguous between two pieces and two crates. A product using the default counted unit MAY omit the label, since that is what a bare number already means today.

#### Scenario: A packaged product reads unambiguously

- **WHEN** a product sold by the crate appears in the catalogue, a cart line, or a stock figure
- **THEN** its quantity is shown together with its unit

### Requirement: Stock limits and totals hold for fractional quantities

Existing quantity limits SHALL keep applying to fractional quantities: a line SHALL NOT exceed the product's live stock, and money SHALL be totalled and rounded exactly as it is for whole quantities.

#### Scenario: A fractional quantity cannot exceed available stock

- **WHEN** a cashier enters a weight greater than the product's live stock
- **THEN** the quantity is capped at the available stock, as it is for counted products

#### Scenario: A fractional line total is rounded like every other amount

- **WHEN** a fractional quantity multiplied by a price yields more than two decimals
- **THEN** the amount is rounded by the same rule the rest of the money path uses

### Requirement: No conversion between purchase and sale units

The system SHALL use a single base unit per product for both buying and selling, and SHALL NOT convert between units. A product bought by weight is sold by weight; a product bought by the crate is sold by the crate.

#### Scenario: The same unit governs both sides

- **WHEN** a product measured in kilograms is purchased and later sold
- **THEN** both quantities are expressed in kilograms, with no conversion applied anywhere
