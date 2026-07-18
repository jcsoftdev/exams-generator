import { InMemoryQuestionGeneratorAdapter } from "./in-memory-question-generator.adapter";
import { runQuestionGeneratorPortContract } from "../domain/ports/question-generator.port.contract";

runQuestionGeneratorPortContract(
  "InMemoryQuestionGeneratorAdapter",
  () => new InMemoryQuestionGeneratorAdapter(),
);
