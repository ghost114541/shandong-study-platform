#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

int knowpaper_webview_pdf(void *view, const char *path, uint64_t identifier,
                         void (*callback)(void *, int, int), void *context);

static void finished(void *context, int status, int terminal) {
    fprintf(stderr, "Native print completed: %d (terminal %d)\n", status, terminal);
    exit(status == 1 && terminal == 1 ? 0 : 3);
}

@interface Probe : NSObject <WKNavigationDelegate>
@property (strong) NSWindow *window;
@property (strong) WKWebView *view;
@property (copy) NSString *destination;
@end

@implementation Probe
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
    [view callAsyncJavaScript:
        @"await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode()));"
         "return document.fonts.status === 'loaded' && !document.querySelector('.katex-error');"
                    arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld
            completionHandler:^(id result, NSError *error) {
        if (error || ![result boolValue]) {
            NSLog(@"Fixture assets failed to load: %@", error);
            exit(2);
        }
        fprintf(stderr, "Fixture loaded, starting native print\n");
        if (knowpaper_webview_pdf((__bridge void *)view, self.destination.fileSystemRepresentation, 1,
                                  finished, NULL) != 1) {
            exit(3);
        }
    }];
}
- (void)webView:(WKWebView *)view didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"Fixture navigation failed: %@", error);
    exit(4);
}
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSLog(@"Fixture navigation failed: %@", error);
    exit(4);
}
@end

int main(int argc, const char *argv[]) {
    if (argc != 3) return 64;
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        __attribute__((objc_precise_lifetime)) Probe *probe = [[Probe alloc] init];
        probe.destination = [NSString stringWithUTF8String:argv[2]];
        NSRect frame = NSMakeRect(0, 0, 850, 1000);
        probe.window = [[NSWindow alloc] initWithContentRect:frame styleMask:NSWindowStyleMaskBorderless
                                                    backing:NSBackingStoreBuffered defer:NO];
        probe.view = [[WKWebView alloc] initWithFrame:frame];
        probe.window.contentView = probe.view;
        probe.view.navigationDelegate = probe;
        NSURL *fixture = [NSURL fileURLWithFileSystemRepresentation:argv[1] isDirectory:NO relativeToURL:nil];
        [probe.view loadFileURL:fixture allowingReadAccessToURL:fixture.URLByDeletingLastPathComponent];
        [NSTimer scheduledTimerWithTimeInterval:60 repeats:NO block:^(NSTimer *timer) {
            NSLog(@"WebKit probe timed out");
            exit(5);
        }];
        [NSApp run];
    }
    return 6;
}
