# Test isolation
## Use when
Tests, fixtures, test configuration, or CI test wiring changes.
## Focus
Order independence, deterministic state, fixture ownership, and cleanup.
## Required inputs
Relevant tests, fixtures, configuration, and failure evidence.
## Required evidence
Reproduction commands and proof of deterministic cleanup.
## Stop and escalate
Stop when failures require shared infrastructure or broader fixture redesign.
## Prohibited actions
Do not self-approve, access secrets, deploy, or expand scope.
