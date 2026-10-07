"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { OTP_LENGTH } from "@/lib/auth-utils";

export function OtpField({
  id,
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={OTP_LENGTH}
      pattern={REGEXP_ONLY_DIGITS}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus
      autoComplete="one-time-code"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      containerClassName="w-full"
    >
      <InputOTPGroup className="w-full justify-between gap-2">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <InputOTPSlot
            key={i}
            index={i}
            aria-invalid={invalid || undefined}
            className="h-12 flex-1 rounded-md border font-mono text-lg font-medium first:rounded-md last:rounded-md"
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
