#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <WebKit/WebKit.h>

int knowpaper_webview_pdf(void *view, const char *path) {
    @autoreleasepool {
        @try {
            WKWebView *webview = (__bridge WKWebView *)view;
            NSURL *destination = [NSURL fileURLWithFileSystemRepresentation:path
                                                               isDirectory:NO relativeToURL:nil];
            NSPrintInfo *info = [[NSPrintInfo alloc] initWithDictionary:@{}];
            info.paperName = @"iso-a4";
            info.paperSize = NSMakeSize(210 * 72.0 / 25.4, 297 * 72.0 / 25.4);
            info.orientation = NSPaperOrientationPortrait;
            info.topMargin = info.bottomMargin = info.leftMargin = info.rightMargin = 15 * 72.0 / 25.4;
            info.horizontallyCentered = NO;
            info.verticallyCentered = NO;
            info.horizontalPagination = NSPrintingPaginationModeFit;
            info.verticalPagination = NSPrintingPaginationModeAutomatic;
            info.jobDisposition = NSPrintSaveJob;
            info.dictionary[NSPrintJobSavingURL] = destination;
            info.dictionary[NSPrintHeaderAndFooter] = @NO;

            NSPrintOperation *operation = [webview printOperationWithPrintInfo:info];
            operation.showsPrintPanel = NO;
            operation.showsProgressPanel = NO;
            return [operation runOperation] ? 1 : 0;
        } @catch (NSException *exception) {
            NSLog(@"KnowPaper WebKit print error: %@", exception.name);
            return -1;
        }
    }
}

int knowpaper_source_print(const unsigned char *bytes, size_t length,
                           unsigned int first, unsigned int last) {
    @autoreleasepool {
        @try {
            PDFDocument *document = [[PDFDocument alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
            if (first == 0 || first > last || last > document.pageCount || !document.allowsPrinting) {
                return -1;
            }
            NSPrintInfo *info = [[NSPrintInfo sharedPrintInfo] copy];
            info.jobDisposition = NSPrintSpoolJob;
            info.dictionary[NSPrintAllPages] = @(first == 1 && last == document.pageCount);
            info.dictionary[NSPrintFirstPage] = @(first);
            info.dictionary[NSPrintLastPage] = @(last);
            NSPrintOperation *operation = [document printOperationForPrintInfo:info
                                                                  scalingMode:kPDFPrintPageScaleDownToFit
                                                                    autoRotate:YES];
            if (!operation) {
                return -1;
            }
            operation.showsPrintPanel = YES;
            return [operation runOperation] ? 1 : 0;
        } @catch (NSException *exception) {
            NSLog(@"KnowPaper PDFKit print error: %@", exception.name);
            return -1;
        }
    }
}
