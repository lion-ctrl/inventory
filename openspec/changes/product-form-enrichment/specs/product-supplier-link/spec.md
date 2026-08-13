## ADDED Requirements

### Requirement: A product may name one preferred supplier

The system SHALL allow a product to reference at most one supplier, chosen from the supplier base, and SHALL treat the reference as optional so that a product without one remains valid and fully usable. The reference SHALL be settable and clearable from the product form.

#### Scenario: A product is created without a supplier

- **WHEN** a product is created without choosing a supplier
- **THEN** it is stored and behaves exactly as products did before this capability existed

#### Scenario: A supplier is attached and later cleared

- **WHEN** an authorized user selects a supplier on a product and saves, then reopens the product and clears the selection
- **THEN** the product first shows that supplier, and afterwards shows none

### Requirement: The supplier picker offers the existing supplier base

The system SHALL populate the product form's supplier picker from the supplier base, using the same operational read any authenticated session may perform. Holding the supplier-management permission SHALL NOT be required to *choose* a supplier while editing a product.

#### Scenario: A product manager without supplier permissions can still pick one

- **WHEN** a user who may manage products but not suppliers opens the product form
- **THEN** the supplier picker lists the existing suppliers and one can be selected

### Requirement: A supplier referenced by a product cannot be deleted

The system SHALL refuse to delete a supplier while any product references it, and SHALL explain in Spanish that the supplier should be marked inactive instead. This mirrors the existing refusal for a supplier that has purchases.

#### Scenario: Deleting a referenced supplier is refused

- **WHEN** a user attempts to delete a supplier that a product names as its preferred supplier
- **THEN** the deletion is rejected with a Spanish message pointing at deactivation, and both the supplier and the product's reference survive

#### Scenario: Retiring the supplier keeps the link

- **WHEN** a supplier referenced by a product is marked inactive
- **THEN** the product still shows that supplier, indicated as inactive, and the product remains editable and sellable

### Requirement: The preferred supplier is a reordering hint, not sales data

The preferred supplier SHALL NOT affect price, stock, tax treatment, or any figure on a sale. It SHALL NOT be frozen onto sales or held carts, and changing it SHALL NOT alter any past record.

#### Scenario: Changing the supplier leaves history untouched

- **WHEN** a product's preferred supplier is changed after that product has been sold and purchased
- **THEN** past sales and past purchases read exactly as they did before the change
