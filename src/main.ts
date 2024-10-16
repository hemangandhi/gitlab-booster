// @ts-ignore isolatedModules

interface DiffsMeta {
  diff_files: Array<{
    new_path: string;
    added_lines: number;
    removed_lines: number;
  }>;
}

async function fetchGitLabData(url: string) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    console.error('Failed to fetch GitLab data:', response.statusText);
    return null;
  }
  return await response.json();
}

//
// Element manipulation
//

function createThreadsBadge(
  element: HTMLElement,
  badgeClassName: string,
  resolved: number,
  resolvable: number,
) {
  const li = $('<li/>')
    .addClass('issuable-comments d-none d-sm-flex')
    .prependTo(element);

  $('<span/>')
    .addClass(
      `gl-badge badge badge-pill badge-${badgeClassName} sm has-tooltip`,
    )
    .text(`${resolved}/${resolvable} threads resolved`)
    .prependTo(li);
}

function createDiffStat(
  element: HTMLElement,
  fileCount: number,
  addLineCount: number,
  deleteLinCount: number,
) {
  $('<div/>')
    .css({ display: 'flex', 'flex-direction': 'row', gap: '3px' })
    .append(
      $('<div/>', { class: 'diff-stats-group' }).append(
        $('<span/>', {
          class: 'gl-text-gray-500 bold',
          text: `${fileCount} files`,
        }),
      ),

      $('<div/>', {
        class:
          'diff-stats-group gl-text-green-600 gl-display-flex gl-align-items-center bold',
      }).append($('<span/>').text('+'), $('<span/>').text(`${addLineCount}`)),

      $('<div/>', {
        class:
          'diff-stats-group gl-text-red-500 gl-display-flex gl-align-items-center bold',
      }).append($('<span/>').text('-'), $('<span/>').text(`${deleteLinCount}`)),
    )
    .prependTo(element);
}

function ensurePanelLayout() {
  // ensure two column scroll structure
  const layout = document.querySelector('div.layout-page');
  if (!layout) {
    return;
  }
  $(layout).css({ display: 'flex', height: '100vh', overflow: 'hidden' });

  const content = document.querySelector('div.content-wrapper');
  if (!content) {
    return;
  }
  $(content).css({ overflowY: 'scroll' });
}

function ensureSidePanel(panelName: string, url: string) {
  const buttonId = `close-${panelName.toLowerCase().replaceAll(' ', '-')}`;

  if (!document.querySelector(`#${buttonId}`)) {
    const topBar = document.querySelector('.top-bar-container');
    if (!topBar) {
      return;
    }
    $(topBar).append(
      $('<button/>', {
        id: buttonId,
        class:
          'btn btn-default btn-md gl-button btn-close js-note-target-close btn-comment btn-comment-and-close',
      }).append($('<span/>').text(`Close ${panelName}`)),
    );

    $(`#${buttonId}`).on('click', function () {
      $('#issue-booster').remove();
      $(`#${buttonId}`).remove();
    });
  }

  const layout = document.querySelector('div.layout-page');
  if (!layout) {
    return;
  }
  $('#issue-booster').remove();
  // this is the only easy way to bypass CSP. But the tampermonkey can only addElement
  GM_addElement(layout, 'iframe', {
    id: 'issue-booster',
    src: url,
    style:
      // make issue panel sticky
      'width: 100%; height: 100vh; position: sticky; align-self: flex-start; top: 0; flex: 0 0 40%;',
  });
}

//
// Data process
//

async function addMergeRequestThreadMeta(
  element: HTMLElement,
  mergeRequestUrl: string,
) {
  // Fetch unresolved threads from GitLab API
  const discussions = await fetchGitLabData(
    `${mergeRequestUrl}/discussions.json`,
  );
  let resolvable = 0;
  let resolved = 0;

  for (const discussion of discussions) {
    if (discussion.resolvable) {
      resolvable += 1;
    }
    if (discussion.resolved) {
      resolved += 1;
    }
  }

  if (resolvable > resolved) {
    createThreadsBadge(element, 'danger', resolved, resolvable);
  } else if (resolved === resolvable && resolvable > 0) {
    createThreadsBadge(element, 'success', resolved, resolvable);
  }
}

async function addMergeRequestDiffMeta(
  element: HTMLElement,
  mergeRequestUrl: string,
) {
  const diffsMeta = await fetchGitLabData(
    `${mergeRequestUrl}/diffs_metadata.json`,
  );

  const { addedLineCount, deleteLinCount, fileCount } =
    dehydrateDiff(diffsMeta);

  createDiffStat(element, fileCount, addedLineCount, deleteLinCount);
}

function dehydrateDiff(diffsMeta: DiffsMeta) {
  const excludeRegexps = [
    /\.po$/, // translation files
    /mocks/, // mocks
    /(spec|test)\.\w+$/, // tests
    /package-lock.json/, // auto generated files
  ];

  let addedLineCount = 0;
  let deleteLinCount = 0;
  let fileCount = 0;

  file_loop: for (const file of diffsMeta.diff_files) {
    for (const excludeRegexp of excludeRegexps) {
      if (excludeRegexp.test(file.new_path)) {
        continue file_loop;
      }
    }
    addedLineCount += file.added_lines;
    deleteLinCount += file.removed_lines;
    fileCount += 1;
  }

  return {
    addedLineCount,
    deleteLinCount,
    fileCount,
  };
}

//
// Page process
//

// Function to enhance the merge request list with unresolved threads
async function enhanceMergeRequestList() {
  const mergeRequests = document.querySelectorAll('.merge-request');

  ensurePanelLayout();

  for (const mergeRequest of mergeRequests) {
    const mergeRequestUrl = mergeRequest.querySelector<HTMLAnchorElement>(
      '.merge-request-title-text a',
    )?.href;

    if (!mergeRequestUrl) {
      continue;
    }

    const metaList = $(mergeRequest).find('.issuable-meta ul, ul.controls')[0];

    await addMergeRequestThreadMeta(metaList, mergeRequestUrl);
    await addMergeRequestDiffMeta(metaList, mergeRequestUrl);

    $(mergeRequest).on('click', function () {
      ensureSidePanel('MR Panel', mergeRequestUrl);
    });
  }
}

// Function to enhance the issue detail page with related project names of merge requests
async function enhanceIssueDetailPage() {
  const title = $('#related-merge-requests')[0];
  if (!title) {
    // no related merge requests
    return;
  }

  ensurePanelLayout();

  // select related items and exclude related issue
  // need to wait for the list to show up as the issue page loads first then loads the related merge request asynchronously
  waitForKeyElements(
    '.issue-details.issuable-details.js-issue-details div.js-issue-widgets .related-items-list li:not(.js-related-issues-token-list-item)',
    function (mergeRequest: HTMLElement) {
      (async function () {
        console.debug(
          'inserting merge request meta to related merge requests',
          mergeRequest,
        );

        const statusSvg = mergeRequest.querySelector('.item-title svg');
        if (!statusSvg) {
          return;
        }
        const mergeRequestStatus = statusSvg.getAttribute('aria-label');

        const mergeRequestUrl =
          mergeRequest.querySelector<HTMLAnchorElement>('.item-title a')?.href;

        if (!mergeRequestUrl) {
          return;
        }

        $(mergeRequest).on('click', function () {
          ensureSidePanel('MR Panel', mergeRequestUrl);
        });

        switch (mergeRequestStatus) {
          case 'opened': {
            $(mergeRequest).css({ 'background-color': '#f9eeda' });
            break;
          }
          case 'merged': {
            break;
          }

          case 'closed': {
            $(mergeRequest).css({
              'background-color': '#c1c1c14d',
              filter: 'grayscale(1)',
              'text-decoration': 'line-through',
            });
            // no need to show the closed details
            return;
          }
        }

        const diffsMeta = await fetchGitLabData(
          `${mergeRequestUrl}/diffs_metadata.json`,
        );

        const metaDiv = mergeRequest.querySelector<HTMLElement>(
          '.item-meta .item-attributes-area',
        );

        if (!metaDiv) {
          return;
        }

        if (mergeRequestStatus === 'opened') {
          await addMergeRequestThreadMeta(metaDiv, mergeRequestUrl);

          await addMergeRequestDiffMeta(metaDiv, mergeRequestUrl);
        }

        $('<span/>').text(diffsMeta.project_path).prependTo(metaDiv);
      })();
    },
    true,
  );
}

function enhanceIssueList() {
  ensurePanelLayout();

  waitForKeyElements('ul.issues-list > li', function (issue: HTMLElement) {
    const issueUrl = issue.querySelector<HTMLAnchorElement>('a')?.href;

    if (!issueUrl) {
      return;
    }

    $(issue).on('click', function () {
      ensureSidePanel('Issue Panel', issueUrl);
    });
  });
}

//
// Entry point
//

const issueDetailRegex = /\/issues\/\d+/;

const mergeRequestListRegex = /\/merge_requests(?!\/\d+)/;

const issueListRegex = /\/issues(?!\/\d+)/;

const enhance = function () {
  if (mergeRequestListRegex.test(window.location.href)) {
    enhanceMergeRequestList();
  }

  if (issueDetailRegex.test(window.location.href)) {
    enhanceIssueDetailPage();
  }

  if (issueListRegex.test(window.location.href)) {
    enhanceIssueList();
  }
};
// Run the script when the DOM is fully loaded
window.onload = enhance;
// Run the script when the URL is changed

if (window.onurlchange === null) {
  // feature is supported
  window.addEventListener('urlchange', enhance);
}
