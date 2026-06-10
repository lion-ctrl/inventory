// @vitest-environment jsdom
// ClientGate — the mandatory client identification before a sale (V/J/E).
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ClientGate } from '@/screens/Sale';
import type { Client } from '@/types';

afterEach(cleanup);

const maria = {
  _id: 'c_maria',
  _creationTime: 0,
  name: 'María González',
  taxPrefix: 'V',
  taxId: '5.123.456',
  kind: 'person',
  createdAt: 0,
} as unknown as Client;

function setup(onClientFound = vi.fn(), onCreateClient = vi.fn()) {
  render(
    <ClientGate
      clients={[maria]}
      online
      onClientFound={onClientFound}
      onCreateClient={onCreateClient}
    />
  );
  return { onClientFound, onCreateClient };
}

const cedulaInput = () => screen.getByPlaceholderText('12.345.678');
const searchButton = () =>
  screen.getByRole('button', { name: /Buscar cliente/ });

describe('ClientGate', () => {
  test('formats the cédula while typing and finds the registered client', async () => {
    const user = userEvent.setup();
    const { onClientFound } = setup();

    await user.type(cedulaInput(), '5123456');
    expect(cedulaInput()).toHaveProperty('value', '5.123.456');

    await user.click(searchButton());
    expect(onClientFound).toHaveBeenCalledWith(maria);
  });

  test('unknown id offers inline creation with the formatted prefill', async () => {
    const user = userEvent.setup();
    const { onClientFound, onCreateClient } = setup();

    await user.type(cedulaInput(), '9999999');
    await user.click(searchButton());

    expect(onClientFound).not.toHaveBeenCalled();
    expect(screen.getByText('Cliente no encontrado')).toBeDefined();
    expect(
      screen.getByText(
        /No hay ningún cliente registrado con V-9\.999\.999\. ¿Quieres crearlo\?/
      )
    ).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Crear cliente/ }));
    expect(onCreateClient).toHaveBeenCalledWith({
      prefix: 'V',
      taxId: '9.999.999',
    });
  });

  test('"Reintentar" dismisses the create prompt', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(cedulaInput(), '9999999');
    await user.click(searchButton());
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.queryByText('Cliente no encontrado')).toBeNull();
    expect(searchButton()).toBeDefined(); // back to the search state
  });

  test('an empty submit asks for the identification', async () => {
    const user = userEvent.setup();
    const { onClientFound } = setup();
    await user.click(searchButton());
    expect(
      screen.getByText('Ingresa la identificación del cliente.')
    ).toBeDefined();
    expect(onClientFound).not.toHaveBeenCalled();
  });

  test('switching to RIF (J) reformats and uses the J placeholder', async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(
      screen.getByLabelText('Tipo de identificación'),
      'J'
    );
    const rifInput = screen.getByPlaceholderText('12345678-9');
    await user.type(rifInput, '155641240');
    expect(rifInput).toHaveProperty('value', '15564124-0');
  });
});
