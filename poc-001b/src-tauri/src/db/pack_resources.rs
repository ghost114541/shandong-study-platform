use super::{
    attachments::{hash, AttachmentStore},
    pack_format::{invalid, Counts, ValidatedPack},
    paper_files::save_regions,
    questions::{insert_question, insert_revision},
    DbError, ErrorKind, RegionLink, Result, Scope,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Default, Serialize)]
pub struct Changes {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
}

impl Changes {
    fn record(&mut self, exists: bool, same: bool) {
        if !exists {
            self.added += 1;
        } else if same {
            self.unchanged += 1;
        } else {
            self.updated += 1;
        }
    }
}

#[derive(Clone, Default, Serialize)]
pub struct PackDiff {
    pub knowledge: Changes,
    pub questions: Changes,
    pub papers: Changes,
    pub images: Changes,
    pub pdfs: Changes,
    pub personal_revisions: usize,
    pub conflicts: usize,
}

impl PackDiff {
    pub(super) fn duplicate(counts: &Counts) -> Self {
        let count = |unchanged| Changes {
            unchanged,
            ..Changes::default()
        };
        Self {
            knowledge: count(counts.knowledge),
            questions: count(counts.questions),
            papers: count(counts.papers),
            images: count(counts.images),
            pdfs: count(counts.pdfs),
            ..Self::default()
        }
    }
}

pub(super) struct Plan<'a> {
    pub(super) diff: PackDiff,
    points: Vec<&'a str>,
    questions: BTreeMap<&'a str, PlannedQuestion>,
    papers: BTreeMap<&'a str, PlannedPaper>,
}

struct PlannedQuestion {
    exists: bool,
    previous: Option<i64>,
    reuse: Option<i64>,
    json: String,
}

struct PlannedPaper {
    exists: bool,
    sha: String,
}

pub(super) fn conflict(message: impl Into<String>) -> DbError {
    DbError::new(ErrorKind::Conflict, message)
}

impl<'a> Plan<'a> {
    pub(super) fn build(db: &Connection, pack: &'a ValidatedPack) -> Result<Self> {
        let owner = &pack.manifest.pack_id;
        let mut plan = Self {
            diff: PackDiff::default(),
            points: Vec::new(),
            questions: BTreeMap::new(),
            papers: BTreeMap::new(),
        };
        let mut subjects_stmt = db.prepare("SELECT id FROM subject")?;
        let rows = subjects_stmt.query_map([], |row| row.get::<_, String>(0))?;
        let subjects = rows.collect::<rusqlite::Result<BTreeSet<_>>>()?;
        let check_subject = |subject: &str| -> Result<()> {
            if subjects.contains(subject) {
                Ok(())
            } else {
                Err(invalid(format!("未知学科 {subject}。")))
            }
        };

        let mut children = BTreeMap::<&str, Vec<&str>>::new();
        let mut ready = VecDeque::new();
        for (id, item) in &pack.knowledge {
            check_subject(&item.subject_id)?;
            let existing = db
                .query_row(
                    "SELECT k.subject_id,k.parent_id,o.pack_id FROM knowledge_point k
                 LEFT JOIN pack_knowledge_owner o ON o.knowledge_id=k.id WHERE k.id=?1",
                    [id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((subject, parent, existing_owner)) = &existing {
                require_owner(existing_owner.as_deref(), owner, "知识点", id)?;
                if subject != &item.subject_id || parent != &item.parent_id {
                    return Err(conflict(format!(
                        "知识点 {id} 的学科和父节点属于固定身份。"
                    )));
                }
            }
            let same = db.query_row(
                "SELECT title=?2 AND sort_order=?3 AND aliases_json=?4 AND rights_id=?5
                 FROM pack_knowledge_version WHERE knowledge_id=?1 ORDER BY version_id DESC LIMIT 1",
                params![id, item.title, item.sort_order, json(&item.aliases)?, item.rights_id], |r| r.get(0),
            ).optional()?.unwrap_or(false);
            plan.diff.knowledge.record(existing.is_some(), same);
            if let Some(parent) = item.parent_id.as_deref() {
                check_knowledge(db, pack, parent, &item.subject_id)?;
                if pack.knowledge.contains_key(parent) {
                    children.entry(parent).or_default().push(id);
                    continue;
                }
            }
            ready.push_back(id.as_str());
        }
        while let Some(id) = ready.pop_front() {
            plan.points.push(id);
            if let Some(items) = children.remove(id) {
                ready.extend(items);
            }
        }
        if plan.points.len() != pack.knowledge.len() {
            return Err(invalid("资源包知识点层级存在循环。"));
        }

        for (id, q) in &pack.questions {
            check_subject(&q.subject_id)?;
            let exists = logical_owner(db, "question", id, &q.subject_id, owner)?;
            for point in &q.knowledge {
                check_knowledge(db, pack, point, &q.subject_id)?;
            }
            let content = q.content.to_json()?;
            let as_stored = |old: &str| super::RevisionContent::from_json(old)?.to_json();
            let current = db.query_row(
                "SELECT id,content_json FROM question_revision WHERE question_id=?1 AND scope='public' ORDER BY id DESC LIMIT 1",
                [id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            ).optional()?;
            let key = db.query_row(
                "SELECT q.revision_id,r.content_json FROM pack_question_version q JOIN question_revision r ON r.id=q.revision_id
                 WHERE q.question_id=?1 AND q.revision_key=?2 LIMIT 1", params![id, q.revision],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            ).optional()?;
            if let Some((known, old)) = key {
                if as_stored(&old)? != content {
                    return Err(conflict(format!(
                        "试题 {id} 的公共修订标识已绑定其他内容。"
                    )));
                }
                if Some(known) != current.as_ref().map(|row| row.0) {
                    return Err(conflict(format!("试题 {id} 的公共修订不能退回历史版本。")));
                }
            }
            let reuse = match &current {
                Some((revision, old)) if as_stored(old)? == content => Some(*revision),
                _ => None,
            };
            let latest = db.query_row(
                "SELECT version_id, rights_id FROM pack_question_version WHERE question_id=?1 ORDER BY version_id DESC LIMIT 1",
                [id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            ).optional()?;
            let same = if let Some((version, rights)) = latest {
                let mut stmt = db.prepare("SELECT knowledge_id FROM pack_question_knowledge WHERE question_id=?1 AND version_id=?2 ORDER BY knowledge_id")?;
                let old = stmt
                    .query_map(params![id, version], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<BTreeSet<_>>>()?;
                reuse.is_some()
                    && rights == q.rights_id
                    && old.iter().eq(q.knowledge.iter().collect::<BTreeSet<_>>())
            } else {
                false
            };
            plan.diff.questions.record(exists, same);
            let personal: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM question_revision WHERE question_id=?1 AND scope='user')",
                [id], |r| r.get(0)
            )?;
            plan.diff.personal_revisions += usize::from(personal);
            plan.questions.insert(
                id,
                PlannedQuestion {
                    exists,
                    previous: current.map(|row| row.0),
                    reuse,
                    json: content,
                },
            );
        }

        for (id, paper) in &pack.papers {
            check_subject(&paper.subject_id)?;
            let exists = logical_owner(db, "paper", id, &paper.subject_id, owner)?;
            let sha = hash(json(paper)?.as_bytes());
            let same = db.query_row(
                "SELECT record_sha=?2 FROM pack_paper_version WHERE paper_id=?1 ORDER BY version_id DESC LIMIT 1",
                params![id, sha], |r| r.get(0),
            ).optional()?.unwrap_or(false);
            plan.diff.papers.record(exists, same);
            for occ in &paper.occurrences {
                let subject = if let Some(q) = pack.questions.get(&occ.question_id) {
                    Some(q.subject_id.clone())
                } else {
                    db.query_row("SELECT q.subject_id FROM question q JOIN pack_question_owner o ON o.question_id=q.id WHERE q.id=?1",
                        [&occ.question_id], |r| r.get::<_, String>(0)).optional()?
                };
                if subject.as_deref() != Some(paper.subject_id.as_str()) {
                    return Err(invalid(format!("试卷 {id} 引用了缺失、私有或跨学科试题。")));
                }
                let existing: Option<String> = db.query_row(
                    "SELECT question_id FROM question_occurrence WHERE paper_id=?1 AND source_key=?2",
                    params![id, occ.source_key], |r| r.get(0),
                ).optional()?;
                if existing.is_some_and(|id| id != occ.question_id) {
                    return Err(conflict(format!(
                        "试卷 {id} 的题号 {} 已关联不同原题。",
                        occ.source_key
                    )));
                }
            }
            plan.papers.insert(id, PlannedPaper { exists, sha });
        }

        for (sha, blob) in &pack.blobs {
            let (query, group) = if blob.mime.is_some() {
                (
                    "SELECT EXISTS(SELECT 1 FROM attachment WHERE sha256=?1)",
                    &mut plan.diff.images,
                )
            } else {
                (
                    "SELECT EXISTS(SELECT 1 FROM paper_file WHERE sha256=?1)",
                    &mut plan.diff.pdfs,
                )
            };
            let exists = db.query_row(query, [sha], |r| r.get(0))?;
            group.record(exists, exists);
        }
        Ok(plan)
    }

    pub(super) fn apply(
        &self,
        db: &Connection,
        store: &AttachmentStore,
        pack: &ValidatedPack,
        version: i64,
    ) -> Result<()> {
        let owner = &pack.manifest.pack_id;
        for id in &self.points {
            let item = &pack.knowledge[*id];
            let present: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM pack_knowledge_owner WHERE knowledge_id=?1)",
                [id],
                |r| r.get(0),
            )?;
            if !present {
                db.execute(
                    "INSERT INTO knowledge_point(id,subject_id,parent_id,title,sort_order,origin) VALUES (?1,?2,?3,?4,?5,'standard')",
                    params![id,item.subject_id,item.parent_id,item.title,item.sort_order],
                )?;
                db.execute(
                    "INSERT INTO pack_knowledge_owner VALUES (?1,?2)",
                    params![id, owner],
                )?;
            }
            db.execute(
                "INSERT INTO pack_knowledge_version VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    id,
                    version,
                    item.title,
                    item.sort_order,
                    json(&item.aliases)?,
                    item.rights_id
                ],
            )?;
        }
        for (sha, blob) in &pack.blobs {
            if let Some(mime) = blob.mime {
                let id = format!("sha256-{sha}");
                db.execute(
                    "INSERT INTO attachment(attachment_id,sha256,media_type,byte_size,storage_key)
                     VALUES (?1,?2,?3,?4,?5) ON CONFLICT(attachment_id) DO NOTHING",
                    params![id, sha, mime, blob.bytes as i64, format!("{}/{sha}", &sha[..2])],
                )?;
            }
        }
        for (id, planned) in &self.questions {
            let q = &pack.questions[*id];
            if !planned.exists {
                insert_question(db, id, &q.subject_id)?;
                db.execute(
                    "INSERT INTO pack_question_owner VALUES (?1,?2)",
                    params![id, owner],
                )?;
            }
            let revision = match planned.reuse {
                Some(id) => id,
                None => insert_revision(
                    db,
                    store,
                    id,
                    Scope::Public,
                    planned.previous,
                    &q.content,
                    &planned.json,
                )?,
            };
            db.execute(
                "INSERT INTO pack_question_version VALUES (?1,?2,?3,?4,?5)",
                params![id, version, q.revision, revision, q.rights_id],
            )?;
            for point in &q.knowledge {
                db.execute(
                    "INSERT INTO pack_question_knowledge VALUES (?1,?2,?3)",
                    params![id, version, point],
                )?;
            }
        }
        for (id, planned) in &self.papers {
            let p = &pack.papers[*id];
            if !planned.exists {
                db.execute(
                    "INSERT INTO paper(id,title,subject_id) VALUES (?1,?2,?3)",
                    params![id, p.title, p.subject_id],
                )?;
                db.execute(
                    "INSERT INTO pack_paper_owner VALUES (?1,?2)",
                    params![id, owner],
                )?;
            }
            db.execute(
                "INSERT INTO pack_paper_version VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    id,
                    version,
                    p.title,
                    p.metadata.year,
                    p.metadata.region,
                    p.metadata.source,
                    p.rights_id,
                    planned.sha
                ],
            )?;
            let mut original = None;
            for file in &p.files {
                let blob = &pack.blobs[&file.sha256];
                let existing = db
                    .query_row(
                        "SELECT id FROM paper_file WHERE paper_id=?1 AND role=?2 AND sha256=?3",
                        params![id, file.role, file.sha256],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?;
                let file_id = if let Some(existing) = existing {
                    existing
                } else {
                    let file_id: String =
                        db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
                    db.execute(
                        "INSERT INTO paper_file(id,paper_id,role,sha256,byte_size,page_count,original_name,source)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![file_id,id,file.role,file.sha256,blob.bytes as i64,blob.pages.map(|pages| pages as i64),file.name,pack.manifest.source],
                    )?;
                    file_id
                };
                db.execute(
                    "INSERT INTO pack_paper_file VALUES (?1,?2,?3)",
                    params![version, file_id, file.rights_id],
                )?;
                if file.role == "original" {
                    original = Some(file_id);
                }
            }
            let file_id = original.ok_or_else(|| invalid("缺少原卷文件。"))?;
            for occurrence in &p.occurrences {
                db.execute(
                    "INSERT INTO question_occurrence(paper_id,source_key,question_id) VALUES (?1,?2,?3)
                     ON CONFLICT(paper_id,source_key) DO NOTHING",
                    params![id,occurrence.source_key,occurrence.question_id],
                )?;
                db.execute(
                    "INSERT INTO pack_paper_occurrence VALUES (?1,?2,?3,?4)",
                    params![version, id, occurrence.source_key, occurrence.question_id],
                )?;
                let present: bool = db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM paper_region WHERE file_id=?1 AND paper_id=?2 AND source_key=?3)",
                    params![file_id,id,occurrence.source_key], |r| r.get(0),
                )?;
                if !present && !occurrence.regions.is_empty() {
                    save_regions(
                        db,
                        &occurrence.question_id,
                        &RegionLink {
                            file_id: file_id.clone(),
                            source_key: occurrence.source_key.clone(),
                            regions: occurrence.regions.clone(),
                        },
                        false,
                    )?;
                }
            }
        }
        Ok(())
    }
}

fn require_owner(actual: Option<&str>, owner: &str, kind: &str, id: &str) -> Result<()> {
    if actual == Some(owner) {
        Ok(())
    } else {
        Err(conflict(format!(
            "{kind} {id} 已属于个人、内置数据或另一个资源包。"
        )))
    }
}

fn logical_owner(
    db: &Connection,
    kind: &str,
    id: &str,
    subject: &str,
    owner: &str,
) -> Result<bool> {
    let (query, label) = match kind {
        "paper" => ("SELECT k.subject_id,o.pack_id FROM paper k LEFT JOIN pack_paper_owner o ON o.paper_id=k.id WHERE k.id=?1", "试卷"),
        _ => ("SELECT k.subject_id,o.pack_id FROM question k LEFT JOIN pack_question_owner o ON o.question_id=k.id WHERE k.id=?1", "试题"),
    };
    let existing = db
        .query_row(query, [id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
            ))
        })
        .optional()?;
    if let Some((actual_subject, actual_owner)) = existing {
        require_owner(actual_owner.as_deref(), owner, label, id)?;
        if actual_subject.as_deref() != Some(subject) {
            return Err(conflict(format!("{label} {id} 的所属学科不可变。")));
        }
        return Ok(true);
    }
    Ok(false)
}

fn check_knowledge(db: &Connection, pack: &ValidatedPack, id: &str, subject: &str) -> Result<()> {
    let found = if let Some(point) = pack.knowledge.get(id) {
        point.subject_id == subject
    } else {
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM knowledge_point WHERE id=?1 AND subject_id=?2 AND enabled=1 AND origin='standard')",
            params![id,subject], |r| r.get(0),
        )?
    };
    if found {
        Ok(())
    } else {
        Err(invalid(format!(
            "知识点 {id} 缺失、为个人资源或所属学科不一致。"
        )))
    }
}

pub(super) fn json(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|_| invalid("无法序列化资源包记录。"))
}
