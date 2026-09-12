-- Part 8: 2-day new-booking restriction after cancelling with 3 active appointments
ALTER TABLE "patients" ADD COLUMN "bookingRestrictedUntil" TIMESTAMP(3);
