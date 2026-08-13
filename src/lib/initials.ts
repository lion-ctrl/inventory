/**
 * The letter shown where a product's photograph would go.
 *
 * Replaces the emoji the product used to carry. It is derived rather than
 * stored, which is the whole point: nobody has to pick one, it exists for every
 * product that has a name, and it survives OFFLINE — where a photographed
 * product has no address to render and would otherwise be an empty box.
 *
 * Follows the shape `clientGlyph` (`src/screens/Clients.tsx`) already
 * established for the same question, so the app answers "no image" one way.
 */
export function initialOf(name?: string): string {
  return (name?.trim()[0] || '?').toUpperCase();
}
