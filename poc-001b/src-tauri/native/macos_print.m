#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <WebKit/WebKit.h>
#include <stdint.h>

enum {
    KPPrintBusy = -3,
    KPPrintRestartRequired = -2,
    KPPrintStartFailed = -1,
    KPPrintFailed = 0,
    KPPrintSucceeded = 1,
    KPPrintWindowClosed = 2,
};

typedef void (*KPPrintCallback)(void *context, int status, int terminal);

@interface KPPrintCompletion : NSObject
@property uint64_t identifier;
@property KPPrintCallback callback;
@property void *context;
@property (strong) NSPrintOperation *operation;
@property (strong) NSWindow *window;
@property BOOL abandoned;
#ifdef KNOWPAPER_PRINT_PROBE
@property int fault;
#endif
- (void)abandon:(int)status;
- (void)complete:(BOOL)success;
- (void)windowWillClose:(NSNotification *)notification;
- (void)operation:(NSPrintOperation *)operation didRun:(BOOL)success contextInfo:(void *)unused;
@end

// AppKit's modal print state is shared with PDFKit on the main thread. A
// timed-out operation keeps this slot until AppKit confirms completion.
static KPPrintCompletion *activePrint;
static BOOL sourcePrinting;

#ifdef KNOWPAPER_PRINT_PROBE
static int nextFault;

void knowpaper_print_probe_inject(int fault) {
    nextFault = fault;
}
#endif

@implementation KPPrintCompletion
- (void)abandon:(int)status {
    if (activePrint != self || self.abandoned) {
        return;
    }
    self.abandoned = YES;
    self.callback(self.context, status, 0);
}

- (void)windowWillClose:(NSNotification *)notification {
    [self abandon:KPPrintWindowClosed];
}

- (void)complete:(BOOL)success {
    if (activePrint != self) {
        return;
    }
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    activePrint = nil;
    self.callback(self.context, success && !self.abandoned ? KPPrintSucceeded : KPPrintFailed, 1);
}

- (void)operation:(NSPrintOperation *)operation didRun:(BOOL)success contextInfo:(void *)unused {
#ifdef KNOWPAPER_PRINT_PROBE
    if (self.fault == 2) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC),
                       dispatch_get_main_queue(), ^{ [self complete:success]; });
        return;
    }
    if (self.fault == 3) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.window close];
            [self complete:success];
        });
        return;
    }
#endif
    // Leave AppKit's delegate stack before admitting another operation.
    dispatch_async(dispatch_get_main_queue(), ^{ [self complete:success]; });
}
@end

void knowpaper_abandon_webview_pdf(uint64_t identifier) {
    if ([NSThread isMainThread] && activePrint.identifier == identifier) {
        [activePrint abandon:KPPrintRestartRequired];
    }
}

static int admissionStatus(void) {
    if (activePrint.abandoned) {
        return KPPrintRestartRequired;
    }
    return activePrint || sourcePrinting || [NSPrintOperation currentOperation]
        ? KPPrintBusy : KPPrintSucceeded;
}

static int startPrinting(NSPrintOperation *operation, NSWindow *window,
                         uint64_t identifier, KPPrintCallback callback, void *context, int fault) {
    if (!operation || !window) {
        return KPPrintStartFailed;
    }
#ifdef KNOWPAPER_PRINT_PROBE
    if (fault == 1) {
        return KPPrintStartFailed;
    }
#endif
    KPPrintCompletion *delegate = [[KPPrintCompletion alloc] init];
#ifdef KNOWPAPER_PRINT_PROBE
    delegate.fault = fault;
#endif
    delegate.identifier = identifier;
    delegate.callback = callback;
    delegate.context = context;
    delegate.operation = operation;
    delegate.window = window;
    operation.canSpawnSeparateThread = NO;
    [[NSNotificationCenter defaultCenter] addObserver:delegate selector:@selector(windowWillClose:)
                                                 name:NSWindowWillCloseNotification object:window];
    activePrint = delegate;
    @try {
        // WebKit computes its page range asynchronously. Running synchronously
        // on the UI thread can prevent that callback and generate blank pages.
        [operation runOperationModalForWindow:window delegate:delegate
                              didRunSelector:@selector(operation:didRun:contextInfo:)
                                 contextInfo:NULL];
    } @catch (NSException *exception) {
        // AppKit may have scheduled work before throwing. Treat the callback
        // as outstanding unless AppKit has already confirmed completion.
        NSLog(@"KnowPaper exception starting AppKit PDF operation: %@", exception.name);
        [delegate abandon:KPPrintRestartRequired];
    }
    return KPPrintSucceeded;
}

int knowpaper_webview_pdf(void *view, const char *path, uint64_t identifier,
                          KPPrintCallback callback, void *context) {
    @autoreleasepool {
        if (![NSThread isMainThread]) {
            return KPPrintStartFailed;
        }
        @try {
            int fault = 0;
#ifdef KNOWPAPER_PRINT_PROBE
            fault = nextFault;
            nextFault = 0;
#endif
            int admission = admissionStatus();
            if (admission != KPPrintSucceeded) {
                return admission;
            }
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
            return startPrinting(operation, webview.window, identifier, callback, context, fault);
        } @catch (NSException *exception) {
            NSLog(@"KnowPaper WebKit print error: %@", exception.name);
            return KPPrintStartFailed;
        }
    }
}

int knowpaper_source_print(const unsigned char *bytes, size_t length,
                           unsigned int first, unsigned int last) {
    @autoreleasepool {
        if (![NSThread isMainThread]) {
            return KPPrintStartFailed;
        }
        @try {
            int admission = admissionStatus();
            if (admission != KPPrintSucceeded) {
                return admission;
            }
            sourcePrinting = YES;
            @try {
                PDFDocument *document = [[PDFDocument alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
                if (first == 0 || first > last || last > document.pageCount || !document.allowsPrinting) {
                    return KPPrintStartFailed;
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
                    return KPPrintStartFailed;
                }
                operation.showsPrintPanel = YES;
                return [operation runOperation] ? KPPrintSucceeded : KPPrintFailed;
            } @finally {
                sourcePrinting = NO;
            }
        } @catch (NSException *exception) {
            NSLog(@"KnowPaper PDFKit print error: %@", exception.name);
            return KPPrintStartFailed;
        }
    }
}
