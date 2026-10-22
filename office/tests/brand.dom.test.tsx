import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FormAlert } from "@/components/auth/form-alert";
import { Logo } from "@/components/brand/logo";

afterEach(cleanup);

describe("Logo", () => {
  it("labels the wordmark as the Office", () => {
    render(<Logo />);
    expect(screen.getByText("DocuMind")).toBeTruthy();
    expect(screen.getByText("Office")).toBeTruthy();
  });
});

describe("FormAlert", () => {
  it("announces errors as alerts and renders nothing without a message", () => {
    const { rerender } = render(<FormAlert message="Wrong password" />);
    expect(screen.getByRole("alert").textContent).toContain("Wrong password");
    rerender(<FormAlert message={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
