// Part 18/19: turn a minute count into a human-friendly estimate string,
// e.g. 8 -> "~10 min", 65 -> "~1 hr 5 min", 120 -> "~2 hr". This is always
// an ESTIMATE, never presented as a guaranteed exact time.
export const formatWaitEstimate = (minutes) => {
  if (minutes == null) return null;
  if (minutes <= 0) return "~0 min";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `~${mins} min`;
  if (mins === 0) return `~${hours} hr`;
  return `~${hours} hr ${mins} min`;
};

// Part 14: "patients ahead" must be based on the ACTUAL active queue, not a
// naive (patientToken - currentToken) subtraction — cancelled/absent tokens
// between the current token and this patient's token must not count.
// `activeTokensAhead` is the count of WAITING/CHECKED_IN appointments in the
// same queue with token > currentToken and token < patientToken.
export const computeQueueView = ({
  currentToken,
  patientToken,
  activeTokensAhead,
  consultationMinutes,
}) => {
  const isYourTurn = currentToken === patientToken;
  const patientsAhead = isYourTurn ? 0 : Math.max(0, activeTokensAhead);
  const minutes = patientsAhead * (consultationMinutes || 0);

  return {
    currentToken,
    yourToken: patientToken,
    patientsAhead,
    isYourTurn,
    estimatedWaitMinutes: consultationMinutes ? minutes : null,
    estimatedWaitLabel: consultationMinutes ? formatWaitEstimate(minutes) : null,
  };
};
