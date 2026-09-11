// Registers jest-dom's DOM matchers (toBeInTheDocument, toBeDisabled, ...)
// on vitest's `expect` — CheckoutForm.test.tsx is the first test in this
// surface to need them.
import "@testing-library/jest-dom/vitest";
