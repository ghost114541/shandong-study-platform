import Foundation
import PDFKit

let simplified = "试卷、选择、观察、复习"
let queries = [simplified, "中文", "中⽂", "全角", "全⻆", "神", "神", "ＡＢＣ１２３", "ABC123"]
var evidence: [String: [String: Int]] = [:]

for path in CommandLine.arguments.dropFirst() {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        fatalError("PDFKit could not read \(path)")
    }
    let counts = Dictionary(uniqueKeysWithValues: queries.map { query in
        (query, document.findString(query, withOptions: .literal).count)
    })
    guard counts[simplified, default: 0] > 0 else {
        fatalError("PDFKit search could not find the simplified Chinese sentence in \(path)")
    }
    evidence[URL(fileURLWithPath: path).lastPathComponent] = counts
}

guard !evidence.isEmpty else { fatalError("No PDF supplied") }
let json = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: json, as: UTF8.self))
