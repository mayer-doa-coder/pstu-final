import { render, screen } from '@testing-library/react';
import HomePage from './page';

describe('HomePage', () => {
  it('renders the foundation placeholder heading', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { name: 'Money Movement' })).toBeInTheDocument();
  });
});
