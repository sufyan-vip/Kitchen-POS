import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import TablesPage from './index';

describe('Stage 2 table management', () => {
  it('renders area, table, status, and floor-layout management', async () => {
    render(<MemoryRouter><TablesPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Tables and floor layout' })).toBeInTheDocument();
    expect(screen.getByText('Dining areas')).toBeInTheDocument();
    expect(screen.getByText('Visual floor layout')).toBeInTheDocument();
    expect(screen.getAllByText('AVAILABLE').length).toBeGreaterThan(0);
    await waitFor(() => { expect(screen.getByText('No dining areas yet.')).toBeInTheDocument(); });
  });
});
