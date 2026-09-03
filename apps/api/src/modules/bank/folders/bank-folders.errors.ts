import { BankFolderErrorCode } from "@exams-generator/shared";
import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * HTTP status + Spanish message per folder error code. Same body shape
 * `ai.controller.ts` uses for `ai_not_configured` — `{ statusCode, code,
 * message }` — because a STABLE code is what lets the web react differently
 * per failure (mark the inline input red vs. reload the tree) instead of
 * string-matching a message.
 *
 * `folder_not_found` is 404 even when the folder exists but belongs to another
 * tenant: same reasoning as `BankService.getQuestionById`, an id must not be
 * usable to probe another school's structure.
 */
const ERROR_SPEC: Readonly<Record<BankFolderErrorCode, { status: HttpStatus; message: string }>> = {
  folder_name_invalid: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "El nombre de la carpeta debe tener entre 1 y 80 caracteres.",
  },
  folder_name_taken: {
    status: HttpStatus.CONFLICT,
    message: "Ya existe una carpeta con ese nombre en el mismo nivel.",
  },
  folder_cycle: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "No puedes mover una carpeta dentro de sí misma.",
  },
  folder_depth_exceeded: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Las carpetas admiten como máximo 6 niveles.",
  },
  folder_not_found: { status: HttpStatus.NOT_FOUND, message: "La carpeta no existe." },
  tenant_required: {
    status: HttpStatus.FORBIDDEN,
    message: "Las carpetas son de cada colegio; tu usuario no pertenece a uno.",
  },
  central_question_has_no_folder: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Las preguntas del banco central no se guardan en carpetas de un colegio.",
  },
};

export function bankFolderError(code: BankFolderErrorCode): HttpException {
  const { status, message } = ERROR_SPEC[code];
  return new HttpException({ statusCode: status, code, message }, status);
}
