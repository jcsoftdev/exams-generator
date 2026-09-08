import { SetMetadata } from "@nestjs/common";
import { FeatureFlag } from "@exams-generator/shared";

export const REQUIRES_FEATURE_KEY = "requiresFeature";

/**
 * Gates ONE handler behind a feature flag.
 *
 * Put this on the routes that START work, never on a whole controller. A
 * class-level gate on `AiJobsController` would also 403 `GET :id/stream` and
 * `POST :id/cancel`, so switching the flag off would leave a school unable to
 * watch or stop a job that is still spending its budget. The rule is: block
 * the way in, never the way out.
 */
export const RequiresFeature = (feature: FeatureFlag) => SetMetadata(REQUIRES_FEATURE_KEY, feature);
