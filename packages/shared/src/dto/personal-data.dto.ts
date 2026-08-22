import { Role } from "../enums/role.enum";

/**
 * Everything the platform stores about one person, as `GET
 * /users/:id/personal-data` returns it (Ley 29733 — derecho de acceso; audit
 * 2026-08-20, M10).
 *
 * The list is short because the platform genuinely holds little: an identity
 * to log in with, and a trail of what that account authored. `authored` is
 * COUNTS, not content: an exam a teacher built belongs to the school, not to
 * the teacher, so it is not theirs to take with them — but how much of it
 * carries their name is exactly what an access request is asking.
 *
 * `passwordHash` is never included. A hash is still a credential; handing it
 * over would be answering "what do you know about me" with a key to the door.
 */
export interface PersonalDataExport {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
    readonly role: Role;
    readonly active: boolean;
    readonly createdAt: string;
  };
  readonly authored: {
    readonly questions: number;
    readonly exams: number;
    readonly generationJobs: number;
  };
  /** When the export was produced — an access request answer is a snapshot, not a live view. */
  readonly exportedAt: string;
}

/**
 * `POST /users/:id/anonymize` (Ley 29733 — derecho de cancelación).
 *
 * Deletion is not available and saying so is more honest than pretending:
 * `questions.created_by` and `exams.created_by` reference this row, and the
 * school's exams must survive a teacher leaving. What CAN be removed is the
 * person: the email becomes a tombstone, the name goes, the password stops
 * working and the account is deactivated. The row remains only as an
 * authorship anchor with nobody behind it.
 */
export interface AnonymizeUserResult {
  readonly id: string;
  /** The tombstone address the account now carries — never a real inbox. */
  readonly email: string;
  readonly anonymizedAt: string;
}
