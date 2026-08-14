## ADDED Requirements

### Requirement: The SKU is derived from the product name, never typed

The system SHALL derive a product's SKU from its name when the product is created. The SKU SHALL NOT be a field the user fills in.

The derivation SHALL be deterministic and readable: accents folded, letters upper-cased, punctuation dropped, words joined by a single hyphen, and the result bounded in length. A name that yields no usable characters SHALL still produce a valid SKU.

#### Scenario: A typical name becomes a readable code

- **WHEN** a product is created named `Café con leche 250g`
- **THEN** its SKU is `CAFE-CON-LECHE-250G` — no accent, no lower case, one hyphen between words

#### Scenario: Punctuation inside a word does not fragment it

- **WHEN** a product is created named `Harina P.A.N. 1kg`
- **THEN** its SKU is `HARINA-PAN-1KG` — the abbreviation stays one word rather than becoming three

#### Scenario: A name with no usable characters still yields a SKU

- **WHEN** a product is created whose name contains no letters or digits
- **THEN** the product is created with a valid non-empty SKU rather than an empty one or an error

### Requirement: Two products never share a SKU

The SKU identifies one product. The system SHALL guarantee uniqueness at the point of creation, on the server, so that two products created from the same name — including by two users at the same time — receive different SKUs.

When a derived SKU is already taken, the system SHALL append the smallest numeric suffix that frees it.

#### Scenario: A repeated name is disambiguated

- **WHEN** a second and a third product are created with a name that derives to an already-taken SKU
- **THEN** they receive that SKU suffixed `-2` and `-3`, and all three products remain distinguishable

#### Scenario: Uniqueness is decided by the server, not the form

- **WHEN** a product is created
- **THEN** the stored SKU is the one the server derived, regardless of what any client displayed beforehand

### Requirement: A product's SKU is fixed once created

Renaming a product SHALL NOT change its SKU. The SKU is an identifier that may already exist outside the system — printed on a shelf label, written on a purchase order, read off a report — and silently rewriting it would invalidate those without warning.

#### Scenario: A rename leaves the SKU alone

- **WHEN** an authorized user changes a product's name after creation
- **THEN** the product keeps the SKU it was created with, and the new name is saved

### Requirement: The form shows the SKU it is about to assign

Because the user no longer types the SKU, the form SHALL still show it: while creating, the code derived from the name as typed, updating as the name changes; while editing, the product's actual stored SKU. In both cases the field SHALL be presented as not editable.

The displayed value is informational. Where a suffix is needed for uniqueness, the stored SKU MAY differ from the preview, and the product's detail view SHALL show the stored one.

#### Scenario: The preview follows the name

- **WHEN** an authorized user types a product name into the creation form
- **THEN** the SKU field shows the code derived from that name and updates as the name changes, and the user cannot type into it

#### Scenario: Editing shows the real SKU, not a fresh derivation

- **WHEN** an authorized user opens an existing product for editing
- **THEN** the SKU field shows the product's stored SKU, unchanged by any edit to the name

### Requirement: Creating a product no longer requires a SKU from the caller

The product creation contract SHALL NOT take a SKU. Removing the field from the form while still requiring it from the caller would only move the invention of the code somewhere less able to guarantee its uniqueness.

#### Scenario: Creation succeeds with name, price, barcode and category alone

- **WHEN** a product is created with the fields the form collects and no SKU
- **THEN** the product is created and carries a derived, unique SKU
