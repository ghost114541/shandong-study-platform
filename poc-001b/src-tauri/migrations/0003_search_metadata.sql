CREATE VIEW question_identity AS
SELECT q.id AS original_id, coalesce(d.canonical_id, q.id) AS logical_id, q.subject_id
FROM question q LEFT JOIN question_duplicate d ON d.duplicate_id = q.id;

CREATE VIEW logical_question AS
SELECT original_id AS id, subject_id FROM question_identity WHERE original_id = logical_id;

CREATE VIEW logical_question_knowledge AS
SELECT i.logical_id, link.question_id AS original_id, link.knowledge_id
FROM question_knowledge link JOIN question_identity i ON i.original_id = link.question_id;
