## ADDED Requirements

### Requirement: A product may carry a photograph

The system SHALL allow an authorized user to attach one photograph to a product from the product form, storing the image in Convex File Storage and keeping only a reference on the product document. The photograph SHALL be optional, replaceable, and removable.

#### Scenario: A photo is attached, replaced and removed

- **WHEN** an authorized user attaches a photo to a product, later replaces it, and later removes it
- **THEN** the product shows the first image, then the second, and finally none — remaining valid and sellable throughout

#### Scenario: The image never travels through the mutation

- **WHEN** a photo is attached
- **THEN** the file is uploaded to storage directly and only its reference is saved with the product

### Requirement: The photograph replaces the emoji as the product's visual identity

The emoji (`glyph`) SHALL be removed from the product: it is no longer stored, no longer asked for on the form, and no longer displayed anywhere. Owner decision, taken with its consequences stated.

Wherever a product was previously shown as an emoji, the system SHALL show its photograph, and SHALL fall back to a neutral placeholder — never to a broken image and never to blank space — when the product has no photograph or the photograph cannot be displayed.

#### Scenario: A product with no photo shows a neutral placeholder

- **WHEN** a product without a photograph appears in the catalogue, a cart line, or a detail view
- **THEN** a neutral placeholder is shown in the space the emoji used to occupy

#### Scenario: A photo that fails to load falls back rather than breaking

- **WHEN** a photographed product is displayed and its image cannot be fetched
- **THEN** the neutral placeholder is shown in its place, with no broken-image indicator

#### Scenario: Existing products lose their emoji without breaking

- **WHEN** a product created before this change — carrying an emoji — is read after it
- **THEN** the product renders through the photograph-or-placeholder path, and no screen displays or requires the removed field

### Requirement: Photographs are an online enhancement, and their absence offline is accepted

Photographs SHALL NOT be mirrored locally, and their absence SHALL NOT degrade any offline capability: browsing the catalogue, searching it, and selling from it SHALL work unchanged while offline.

Because storage addresses are network-backed and the emoji fallback has been removed, a photographed product WILL render as the neutral placeholder while offline. This is an accepted consequence of removing the emoji, recorded so it is never mistaken for a defect: offline, products are distinguished by name, SKU and barcode rather than by sight.

#### Scenario: Offline, a photographed product is still usable

- **WHEN** the device is offline and a product that has a photograph is displayed
- **THEN** the neutral placeholder is shown, the product can still be searched, added to a cart and sold, and no error is surfaced about the missing image

### Requirement: The catalogue read resolves photographs for the client

The system SHALL resolve each stored photograph to a displayable address as part of the catalogue read, so a screen never issues a separate request per product to discover it. Products without a photograph SHALL cost nothing additional.

#### Scenario: Only photographed products carry an address

- **WHEN** the catalogue is read and only some products have photographs
- **THEN** those products carry a displayable image address and the rest carry none
