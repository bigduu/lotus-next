export function isGoalResumeCommand(message: string): boolean {
  return /^\p{White_Space}*\/goal\p{White_Space}+resume\p{White_Space}*$/u.test(message.trim().toLowerCase())
}
