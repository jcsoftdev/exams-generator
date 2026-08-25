import { getTableColumns } from "drizzle-orm";
import { examBlueprintRows, examVersions } from "./exams.schema";
import { examBlueprintTemplateRows } from "./exam-blueprint-template-rows.schema";

describe("columnas de maqueta oficial (spec §4)", () => {
  it("exam_blueprint_rows lleva orden, bloque y sección", () => {
    const columns = getTableColumns(examBlueprintRows);

    expect(columns.sortOrder.name).toBe("sort_order");
    expect(columns.sortOrder.notNull).toBe(true);
    expect(columns.blockCode.name).toBe("block_code");
    expect(columns.blockLabel.name).toBe("block_label");
    expect(columns.sectionCode.name).toBe("section_code");
    expect(columns.sectionLabel.name).toBe("section_label");
  });

  it("exam_blueprint_template_rows lleva orden y bloque (exam_section ya guardaba el código)", () => {
    const columns = getTableColumns(examBlueprintTemplateRows);

    expect(columns.sortOrder.name).toBe("sort_order");
    expect(columns.sortOrder.notNull).toBe(true);
    expect(columns.blockCode.name).toBe("block_code");
    expect(columns.blockLabel.name).toBe("block_label");
    expect(columns.blockQuestionCount.name).toBe("block_question_count");
    expect(columns.sectionLabel.name).toBe("section_label");
    expect(columns.examSection.name).toBe("exam_section");
  });

  it("exam_versions congela su estructura en section_layout", () => {
    const columns = getTableColumns(examVersions);

    expect(columns.sectionLayout.name).toBe("section_layout");
    expect(columns.sectionLayout.notNull).toBe(true);
  });
});
