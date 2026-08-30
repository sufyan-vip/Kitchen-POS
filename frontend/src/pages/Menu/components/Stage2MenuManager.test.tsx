import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Stage2MenuManager from './Stage2MenuManager';

describe('Stage2MenuManager', () => {
  it('renders the complete menu-management sections with the safe empty state', async () => {
    render(<Stage2MenuManager menuId={1} />);
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(screen.getByText('Variants and sizes')).toBeInTheDocument();
    expect(screen.getByText('Modifier groups')).toBeInTheDocument();
    expect(screen.getByText('Item modifier associations')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('No records yet. Use the form above to add one.').length).toBeGreaterThan(0);
    });
  });
});
