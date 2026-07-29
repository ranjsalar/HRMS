import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { BackLink } from "./BackLink";

describe("TextField", () => {
  it("links the error message to the input via aria-describedby, and marks it invalid", () => {
    render(<TextField label="Email" error="Enter a valid email address." value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const errorId = input.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveAttribute("id", errorId);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("has no error wiring at all when no error is passed", () => {
    render(<TextField label="Email" value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Button", () => {
  it("is disabled and shows a spinner while loading, and does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick normally when not loading", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Submit</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("BackLink — direction-aware chevron", () => {
  it("carries the rtl: flip utility so the chevron reverses under dir=rtl", () => {
    render(<BackLink href="/login">Back</BackLink>);
    const svg = screen.getByRole("link").querySelector("svg");
    expect(svg).toHaveClass("rtl:rotate-180");
  });
});
