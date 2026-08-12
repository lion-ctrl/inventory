## ADDED Requirements

### Requirement: A purchase records what arrived from a supplier

The system SHALL persist a purchase against exactly one supplier, carrying one line per product received with that product's quantity, an optional note, the employee who registered it, and when. The supplier name and each product name SHALL be frozen onto the purchase at the moment it is registered, so later renaming does not rewrite what a past order says arrived. A purchase line SHALL NOT carry a per-unit cost.

#### Scenario: A purchase is registered with several products

- **WHEN** an authorized user registers a purchase from a supplier with two products and their quantities
- **THEN** the purchase is stored against that supplier with both lines, the supplier's and products' names as they read at that moment, and the registering employee's name

#### Scenario: Renaming a product later does not alter the purchase

- **WHEN** a product is renamed after a purchase that included it
- **THEN** the stored purchase still shows the product name as it was when the order was received

### Requirement: Registering a purchase raises stock

Registering a purchase SHALL increase each referenced product's stock by that line's quantity. This SHALL be the only operation in the system that raises stock automatically.

#### Scenario: Received units enter inventory

- **WHEN** a purchase of 50 units of a product is registered
- **THEN** that product's stock increases by 50 without any manual adjustment

### Requirement: A purchase is applied all-or-nothing

The system SHALL resolve every referenced product before modifying any stock, and SHALL reject the entire purchase if any referenced product no longer exists, leaving all stock untouched. Quantities and the amount SHALL be validated as positive finite numbers, rejecting zero, negatives, `NaN` and `Infinity`, and a purchase with no lines SHALL be rejected. Every rejection SHALL be explained in Spanish.

#### Scenario: A deleted product aborts the whole order

- **WHEN** a purchase references one existing product and one that has since been deleted
- **THEN** the purchase is rejected and the existing product's stock is unchanged

#### Scenario: Invalid quantities and amounts are refused

- **WHEN** a purchase is submitted with no products, with a quantity of zero, or with an amount of zero
- **THEN** each attempt is rejected with its own Spanish message and nothing is stored

### Requirement: A purchase carries one global amount, enterable in bolívares or dollars

The system SHALL record a single total for the whole order rather than a cost per line. The user SHALL be able to enter that total in either bolívares or dollars, and the interface SHALL show the equivalent in the other currency as it is typed, with the field last typed in taken as the source of truth.

#### Scenario: Typing in bolívares shows the dollar equivalent

- **WHEN** the user types a bolívar total while a positive exchange rate is configured
- **THEN** the dollar field shows the converted amount immediately, and vice versa

### Requirement: The purchase total is derived and rate-stamped by the server

The system SHALL derive the stored dollar total server-side from the amount the user typed and the currency they chose, and SHALL NOT accept a total supplied by the client. The purchase SHALL store the typed amount, its currency, and the exchange rate in force at that moment, so the recorded purchase does not change meaning when the rate later moves. When the amount is entered in bolívares and no positive exchange rate is configured, the system SHALL refuse the purchase and say so in Spanish.

#### Scenario: A bolívar amount is converted and stamped

- **WHEN** a purchase is registered for 365 bolívares while the configured rate is 36.5
- **THEN** the stored dollar total is 10, the typed amount, its currency and the rate 36.5 are stored with it, and a later change to the configured rate does not alter any of them

#### Scenario: No configured rate blocks a bolívar amount

- **WHEN** a purchase is entered in bolívares while no positive rate is configured
- **THEN** the purchase is refused and the user is told to enter the amount in dollars

### Requirement: Deleting a purchase returns the stock

Deleting a purchase SHALL subtract each line's quantity from the referenced product's stock, and SHALL never drive a product's stock below zero. Deleting a purchase that no longer exists SHALL be a silent no-op. Deletion SHALL require the same permission as registering a purchase, and the user SHALL be told how many units will leave inventory before confirming.

#### Scenario: Reversal restores the previous stock

- **WHEN** a purchase that raised a product's stock by 50 is deleted
- **THEN** that product's stock returns to its previous value

#### Scenario: Reversal never produces negative stock

- **WHEN** a purchase of 50 units is deleted after 47 of them have already been sold
- **THEN** the product's stock becomes zero rather than a negative number

### Requirement: Purchases require the supplier-management permission

The system SHALL require the `manage_suppliers` permission to register or delete a purchase, and SHALL allow any authenticated session to read a supplier's purchase history.

#### Scenario: An employee without the permission cannot register a purchase

- **WHEN** an authenticated employee lacking `manage_suppliers` attempts to register a purchase
- **THEN** the attempt is rejected with "Sin permisos para esta acción." and no stock changes

### Requirement: A supplier's history shows only its own purchases

The system SHALL return the purchases belonging to the requested supplier and no others, ordered most recent first, resolved through an index rather than by scanning.

#### Scenario: Two suppliers keep separate histories

- **WHEN** a purchase is registered for one supplier and another supplier's history is requested
- **THEN** the second supplier's history is empty

### Requirement: Purchases are online-only and say so offline

Because registering a purchase moves stock, the system SHALL NOT queue purchases while offline and SHALL NOT mirror purchase history locally. While offline, the supplier's detail SHALL state that the purchase history requires a connection and SHALL disable registering a purchase, rather than rendering an empty history that would read as "nothing was ever ordered".

#### Scenario: Offline history is declared unavailable, not empty

- **WHEN** the device is offline and a supplier's detail is opened
- **THEN** the purchase history states that it requires a connection and the "Registrar compra" action is disabled
