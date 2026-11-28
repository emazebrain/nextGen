/**
 * Who a patient is assigned to: the names of the therapists on the current care team, the primary first. Shown
 * wherever a patient is shown, to every kind of signed-in user. `patientId` is an SQL expression, e.g. "p.id".
 * A staff name is not patient data; what the caller may read is still decided by row-level security.
 */
export const therapistsOf = (patientId: string): string =>
  `COALESCE((SELECT array_agg(ctu.full_name ORDER BY ctm.role, ctu.full_name)
               FROM app.patient_care_team ctm JOIN app.app_user ctu ON ctu.id = ctm.user_id
              WHERE ctm.patient_id = ${patientId} AND ctm.ended_at IS NULL), '{}')`;
