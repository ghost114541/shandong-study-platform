import Foundation
import PDFKit

struct SearchResult: Encodable {
    let query: String
    let codePoints: [String]
    let matches: Int
}

let simplified = ["试卷", "选择", "观察", "复习"]
let queries = simplified + ["试卷、选择、观察、复习", "中文", "中⽂", "全角", "全⻆", "神", "神", "ＡＢＣ１２３", "ABC123"]
var evidence: [String: [SearchResult]] = [:]
var unreadableSearches: [String] = []

for path in CommandLine.arguments.dropFirst() {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        fatalError("PDFKit could not read \(path)")
    }
    // Swift String keys use canonical equivalence, even for queries sent with
    // PDFKit's literal search option. Preserve each input as an ordered row.
    let matches = queries.map { query in
        SearchResult(query: query, codePoints: query.unicodeScalars.map { String(format: "U+%04X", $0.value) },
                     matches: document.findString(query, withOptions: .literal).count)
    }
    let file = URL(fileURLWithPath: path).lastPathComponent
    evidence[file] = matches
    for result in matches.prefix(simplified.count) where result.matches == 0 {
        unreadableSearches.append("\(file): \(result.query)")
    }
}

guard !evidence.isEmpty else { fatalError("No PDF supplied") }
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let json = try encoder.encode(evidence)
print(String(decoding: json, as: UTF8.self))
if !unreadableSearches.isEmpty {
    FileHandle.standardError.write(Data("PDFKit search misses: \(unreadableSearches.joined(separator: ", "))\n".utf8))
    exit(1)
}
