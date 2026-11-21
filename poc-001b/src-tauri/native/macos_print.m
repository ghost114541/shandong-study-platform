#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

typedef void (*KPPrintCallback)(void *context, int status);

@interface KPPrintCompletion : NSObject
@property KPPrintCallback callback;
@end

static char completionKey;
static BOOL printing;

@implementation KPPrintCompletion
- (void)operation:(NSPrintOperation *)operation didRun:(BOOL)success contextInfo:(void *)context {
    printing = NO;
    self.callback(context, success ? 1 : 0);
    objc_setAssociatedObject(operation, &completionKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
@end

static int startPrinting(NSPrintOperation *operation, NSWindow *window,
                         KPPrintCallback callback, void *context) {
    if (!operation || !window || printing) {
        return -1;
    }
    KPPrintCompletion *delegate = [[KPPrintCompletion alloc] init];
    delegate.callback = callback;
    objc_setAssociatedObject(operation, &completionKey, delegate, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    printing = YES;
    @try {
        // WebKit computes its page range asynchronously. Running synchronously
        // on the UI thread can prevent that callback and generate blank pages.
        [operation runOperationModalForWindow:window delegate:delegate
                              didRunSelector:@selector(operation:didRun:contextInfo:)
                                 contextInfo:context];
        return 1;
    } @catch (NSException *exception) {
        printing = NO;
        NSLog(@"KnowPaper cannot start PDF printing: %@", exception.name);
        return -1;
    }
}

int knowpaper_webview_pdf(void *view, const char *path, KPPrintCallback callback, void *context) {
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
            return startPrinting(operation, webview.window, callback, context);
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
