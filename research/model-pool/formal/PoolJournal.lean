import Init

namespace PoolJournal
inductive Phase where
  | ready
  | running (family : Nat)
  | unknown
  deriving DecidableEq, Repr

structure State where
  cap : Nat
  used : Nat
  first : Option Nat
  second : Option Nat
  phase : Phase
  deriving DecidableEq, Repr

inductive Event where
  | start (family : Nat)
  | validated
  | failed
  | unknown
  deriving DecidableEq, Repr

def initial (cap : Nat) : State := ⟨cap, 0, none, none, .ready⟩

def step (s : State) (e : Event) : Option State :=
  match s.phase, e with
  | .ready, .start f =>
    if s.used < s.cap ∧ s.second = none ∧ s.first ≠ some f then
      some { s with used := s.used + 1, phase := .running f }
    else none
  | .running f, .validated =>
    if s.first = none then
      some { s with first := some f, phase := .ready }
    else if s.second = none ∧ s.first ≠ some f then
      some { s with second := some f, phase := .ready }
    else none
  | .running _, .failed => some { s with phase := .ready }
  | .running _, .unknown => some { s with phase := .unknown }
  | _, _ => none

def Invariant (s : State) : Prop :=
  s.used ≤ s.cap ∧
  (∀ a b, s.first = some a → s.second = some b → a ≠ b) ∧
  (s.second ≠ none → s.first ≠ none)

theorem initial_safe (cap : Nat) : Invariant (initial cap) := by
  simp [Invariant, initial]

theorem step_safe {s t : State} {e : Event}
    (hInv : Invariant s) (h : step s e = some t) : Invariant t := by
  rcases hInv with ⟨hb, hi, hs⟩
  cases e with
  | start f =>
    cases hp : s.phase <;> simp [step, hp] at h
    rcases h with ⟨⟨hLt, _, _⟩, rfl⟩
    exact ⟨Nat.succ_le_of_lt hLt, hi, hs⟩
  | validated =>
    cases hp : s.phase with
    | ready => simp [step, hp] at h
    | unknown => simp [step, hp] at h
    | running f =>
      by_cases hf : s.first = none
      · simp [step, hp, hf] at h
        subst t
        have hSecond : s.second = none := by
          by_cases hS : s.second = none
          · exact hS
          · exact False.elim (hs hS hf)
        simp [Invariant, hSecond, hb]
      · by_cases hg : s.second = none ∧ s.first ≠ some f
        · simp [step, hp, hf, hg] at h
          subst t
          refine ⟨hb, ?_, ?_⟩
          · intro a b ha heq
            change some f = some b at heq
            have hfb : f = b := Option.some.inj heq
            subst b
            intro hEq
            subst a
            exact hg.2 ha
          · intro _
            exact hf
        · simp [step, hp, hf, hg] at h
  | failed =>
    cases hp : s.phase <;> simp [step, hp] at h
    subst t
    exact ⟨hb, hi, hs⟩
  | unknown =>
    cases hp : s.phase <;> simp [step, hp] at h
    subst t
    exact ⟨hb, hi, hs⟩

theorem frozen_first {s t : State} {e : Event} {a : Nat}
    (hFirst : s.first = some a) (h : step s e = some t) :
    t.first = some a := by
  cases e with
  | start f =>
    cases hp : s.phase <;> simp [step, hp, hFirst] at h
    rcases h with ⟨_, rfl⟩
    rfl
  | validated =>
    cases hp : s.phase with
    | ready => simp [step, hp] at h
    | unknown => simp [step, hp] at h
    | running f =>
      by_cases hg : s.second = none ∧ a ≠ f
      · simp [step, hp, hFirst, hg] at h
        subst t
        rfl
      · simp [step, hp, hFirst, hg] at h
  | failed =>
    cases hp : s.phase <;> simp [step, hp] at h
    subst t
    exact hFirst
  | unknown =>
    cases hp : s.phase <;> simp [step, hp] at h
    subst t
    exact hFirst

theorem unknown_absorbing {s : State} (h : s.phase = .unknown) (e : Event) :
    step s e = none := by cases e <;> simp [step, h]

theorem pending_blocks_start {s : State} {a : Nat}
    (h : s.phase = .running a) (f : Nat) : step s (.start f) = none := by
  simp [step, h]

inductive Reach (cap : Nat) : State → Prop where
  | init : Reach cap (initial cap)
  | next {s t : State} {e : Event} :
      Reach cap s → step s e = some t → Reach cap t

theorem reachable_safe {cap : Nat} {s : State} (h : Reach cap s) : Invariant s := by
  induction h with
  | init => exact initial_safe cap
  | next _ hs ih => exact step_safe ih hs

-- Positive witness: success / known failure / replacement reaches both slots.
def run : State → List Event → Option State
  | s, [] => some s
  | s, e :: es => (step s e).bind (fun t => run t es)

example : run (initial 3) [.start 1, .validated, .start 2, .failed, .start 3, .validated]
    = some ⟨3, 3, some 1, some 3, .ready⟩ := by decide
example : run (initial 2) [.start 1, .unknown, .start 2] = none := by decide
example : run (initial 2) [.start 1, .failed, .start 2, .failed, .start 3] = none := by decide

#print axioms reachable_safe
#print axioms frozen_first
#print axioms unknown_absorbing
#print axioms pending_blocks_start
end PoolJournal

open PoolJournal

def eventOf (i : Nat) : Event :=
  if i < 3 then .start (i+1) else if i = 3 then .validated else if i = 4 then .failed else .unknown

def optionCode (v : Option Nat) : String :=
  match v with
  | none => "0"
  | some n => toString n

def phaseCode (p : Phase) : String :=
  match p with
  | .ready => "ready"
  | .running f => "running:" ++ toString f
  | .unknown => "unknown"

def showState (s : State) : String :=
  String.intercalate "|" [toString s.used, optionCode s.first, optionCode s.second, phaseCode s.phase]

def emit (s : State) (path : List Nat) (fuel : Nat) : IO Unit := do
  match fuel with
  | 0 => pure ()
  | n+1 =>
    for i in List.range 6 do
      let nextPath := path ++ [i]
      let linePrefix := "TRACE|" ++ toString s.cap ++ "|" ++ String.intercalate "," (nextPath.map toString) ++ "|"
      match step s (eventOf i) with
      | none => IO.println (linePrefix ++ "reject")
      | some t =>
        IO.println (linePrefix ++ "accept|" ++ showState t)
        emit t nextPath n

def main : IO Unit := do
  for cap in [2,3,4] do
    emit (initial cap) [] 6
